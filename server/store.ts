import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";

type Row = Record<string, any>;
type Helpers = {
  fail: (status:number,message:string)=>never;
  text: (value:unknown,name:string,max:number,min?:number)=>string;
};
const now=()=>new Date().toISOString();
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const money=(value:number)=>Math.round(value);

export function installStore(app:Express,db:DatabaseSync,helpers:Helpers){
  const {fail,text}=helpers;
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_products(
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK(kind IN ('physical','digital')),
      price_cents INTEGER NOT NULL CHECK(price_cents>=0),
      cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(cost_cents>=0),
      currency TEXT NOT NULL CHECK(currency IN ('XCD','USD')),
      stock_qty INTEGER NOT NULL DEFAULT 0 CHECK(stock_qty>=0),
      active INTEGER NOT NULL DEFAULT 1,
      delivery_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS store_orders(
      id TEXT PRIMARY KEY,
      reference TEXT UNIQUE NOT NULL,
      access_hash TEXT NOT NULL,
      request_key TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reservation_expires_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','confirmed','paid','fulfilled','cancelled')),
      customer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      fulfillment TEXT NOT NULL CHECK(fulfillment IN ('pickup','delivery','digital')),
      address TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT 'pending',
      total_cents INTEGER NOT NULL,
      total_cost_cents INTEGER NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('XCD','USD'))
    );
    CREATE TABLE IF NOT EXISTS store_order_items(
      order_id TEXT NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES store_products(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity>0),
      unit_price_cents INTEGER NOT NULL,
      unit_cost_cents INTEGER NOT NULL,
      PRIMARY KEY(order_id,product_id)
    );
    CREATE INDEX IF NOT EXISTS store_orders_status_date ON store_orders(status,created_at);
  `);

  const seed=[
    ["combat-zone-gift-pass","CombatZone Gift Pass","Digital gift credit for a future CombatZone booking.","digital",5000,0,"XCD",0,"Present this order reference when booking. Value: EC$50."],
    ["battle-photo-pack","Battle Photo Pack","Digital event photo pack delivered after your mission.","digital",3500,500,"XCD",0,"Your download/gallery instructions will appear here after fulfillment."],
    ["combat-zone-tee","CombatZone SLU T-Shirt","CombatZone branded T-shirt. Size confirmed before fulfillment.","physical",6500,3000,"XCD",20,""],
    ["team-wristband","CombatZone Team Wristband","Reusable branded team wristband.","physical",1500,500,"XCD",60,""],
  ] as const;
  for(const [slug,name,description,kind,price,cost,currency,stock,delivery] of seed){
    db.prepare(`
      INSERT OR IGNORE INTO store_products(id,slug,name,description,kind,price_cents,cost_cents,currency,stock_qty,active,delivery_text,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)
    `).run(randomUUID(),slug,name,description,kind,price,cost,currency,stock,delivery,now(),now());
  }

  function cleanupExpired(){
    const rows=db.prepare("SELECT id FROM store_orders WHERE status='pending' AND reservation_expires_at<?").all(now()) as Row[];
    for(const row of rows){
      db.exec("BEGIN IMMEDIATE");
      try{
        const items=db.prepare("SELECT product_id,kind,quantity FROM store_order_items WHERE order_id=?").all(row.id) as Row[];
        for(const item of items) if(item.kind==="physical")
          db.prepare("UPDATE store_products SET stock_qty=stock_qty+?,updated_at=? WHERE id=?").run(item.quantity,now(),item.product_id);
        db.prepare("UPDATE store_orders SET status='cancelled',updated_at=? WHERE id=?").run(now(),row.id);
        db.exec("COMMIT");
      }catch(error){db.exec("ROLLBACK");throw error;}
    }
  }

  const publicProduct=(row:Row)=>({
    id:row.id,slug:row.slug,name:row.name,description:row.description,kind:row.kind,
    priceCents:row.price_cents,currency:row.currency,
    stockQty:row.kind==="physical"?row.stock_qty:null,
    available:row.kind==="digital"||row.stock_qty>0,
  });

  app.get("/api/store/products",(_req,res)=>{
    cleanupExpired();
    res.json((db.prepare("SELECT * FROM store_products WHERE active=1 ORDER BY kind,name").all() as Row[]).map(publicProduct));
  });

  app.post("/api/store/orders",rateLimit({windowMs:60*60_000,limit:12,standardHeaders:"draft-8",legacyHeaders:false}),(req,res)=>{
    cleanupExpired();
    const requestKey=String(req.get("Idempotency-Key")||"");
    if(!/^[a-f0-9-]{36}$/i.test(requestKey)) fail(400,"Missing order request identifier.");
    const existing=db.prepare("SELECT reference,access_hash FROM store_orders WHERE request_key=?").get(requestKey) as Row|undefined;
    if(existing) return res.status(409).json({error:"This order was already submitted. Check your existing order confirmation."});
    if(!Array.isArray(req.body.items)||req.body.items.length<1||req.body.items.length>20) fail(400,"Choose at least one store item.");
    const customerName=text(req.body.customerName,"customer name",120,2);
    const email=text(req.body.email,"email",254,3).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,"Enter a valid email.");
    const phone=text(req.body.phone,"phone",30,7);
    const fulfillment=["pickup","delivery","digital"].includes(req.body.fulfillment)?req.body.fulfillment:"pickup";
    const address=fulfillment==="delivery"?text(req.body.address,"delivery address",500,5):text(req.body.address??"","delivery address",500);
    const notes=text(req.body.notes??"","order notes",1000);
    const requested=new Map<string,number>();
    for(const item of req.body.items){
      const id=String(item?.productId||"");
      const qty=Number(item?.quantity);
      if(!id||!Number.isInteger(qty)||qty<1||qty>20) fail(400,"Check store quantities.");
      requested.set(id,(requested.get(id)||0)+qty);
    }
    if([...requested.values()].reduce((a,b)=>a+b,0)>50) fail(400,"Order quantity is too large.");
    const products=[...requested.keys()].map((id)=>db.prepare("SELECT * FROM store_products WHERE id=? AND active=1").get(id) as Row|undefined);
    if(products.some((p)=>!p)) fail(400,"One or more store items are unavailable.");
    const rows=products as Row[];
    const currencies=new Set(rows.map((p)=>p.currency));
    if(currencies.size!==1) fail(400,"Items with different currencies cannot be combined.");
    const hasPhysical=rows.some((p)=>p.kind==="physical");
    if(hasPhysical&&fulfillment==="digital") fail(400,"Choose pickup or delivery for physical items.");
    for(const p of rows){
      const qty=requested.get(p.id)!;
      if(p.kind==="physical"&&p.stock_qty<qty) fail(409,`${p.name} does not have enough stock for that quantity.`);
    }
    const id=randomUUID();
    const reference=`CZ-SHOP-${randomBytes(5).toString("hex").toUpperCase()}`;
    const accessToken=randomBytes(32).toString("hex");
    const total=rows.reduce((sum,p)=>sum+p.price_cents*requested.get(p.id)!,0);
    const cost=rows.reduce((sum,p)=>sum+p.cost_cents*requested.get(p.id)!,0);
    const expires=new Date(Date.now()+24*60*60_000).toISOString();
    db.exec("BEGIN IMMEDIATE");
    try{
      db.prepare(`
        INSERT INTO store_orders(id,reference,access_hash,request_key,created_at,updated_at,reservation_expires_at,status,
          customer_name,email,phone,fulfillment,address,notes,total_cents,total_cost_cents,currency)
        VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?, ?,?)
      `).run(id,reference,digest(accessToken),requestKey,now(),now(),expires,customerName,email,phone,fulfillment,address,notes,total,cost,rows[0].currency);
      for(const p of rows){
        const qty=requested.get(p.id)!;
        db.prepare("INSERT INTO store_order_items(order_id,product_id,name,kind,quantity,unit_price_cents,unit_cost_cents) VALUES(?,?,?,?,?,?,?)")
          .run(id,p.id,p.name,p.kind,qty,p.price_cents,p.cost_cents);
        if(p.kind==="physical") db.prepare("UPDATE store_products SET stock_qty=stock_qty-?,updated_at=? WHERE id=?").run(qty,now(),p.id);
      }
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
    res.status(201).json({reference,accessToken,status:"pending",totalCents:total,currency:rows[0].currency,reservationExpiresAt:expires});
  });

  app.get("/api/store/orders/:reference/:token",(req,res)=>{
    cleanupExpired();
    const order=db.prepare("SELECT * FROM store_orders WHERE reference=? AND access_hash=?")
      .get(String(req.params.reference),digest(String(req.params.token))) as Row|undefined;
    if(!order) fail(404,"Store order not found.");
    const items=db.prepare(`
      SELECT oi.name,oi.kind,oi.quantity,oi.unit_price_cents AS unitPriceCents,
             CASE WHEN o.status='fulfilled' AND oi.kind='digital' THEN p.delivery_text ELSE '' END AS deliveryText
      FROM store_order_items oi JOIN store_orders o ON o.id=oi.order_id JOIN store_products p ON p.id=oi.product_id
      WHERE oi.order_id=? ORDER BY oi.name
    `).all(order.id);
    res.json({
      reference:order.reference,status:order.status,createdAt:order.created_at,
      reservationExpiresAt:order.reservation_expires_at,fulfillment:order.fulfillment,
      totalCents:order.total_cents,currency:order.currency,items,
    });
  });

  app.get("/api/admin/store/products",(_req,res)=>{
    res.json(db.prepare("SELECT * FROM store_products ORDER BY active DESC,kind,name").all());
  });
  app.post("/api/admin/store/products",(req,res)=>{
    const slug=text(req.body.slug,"slug",80,2).toLowerCase();
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(400,"Use a URL-safe product slug.");
    const kind=["physical","digital"].includes(req.body.kind)?req.body.kind:null;
    if(!kind) fail(400,"Choose physical or digital.");
    const price=Number(req.body.priceCents),cost=Number(req.body.costCents??0),stock=Number(req.body.stockQty??0);
    if(!Number.isInteger(price)||price<0||!Number.isInteger(cost)||cost<0||!Number.isInteger(stock)||stock<0) fail(400,"Check product price, cost and stock.");
    const currency=["XCD","USD"].includes(req.body.currency)?req.body.currency:"XCD";
    const id=randomUUID(),stamp=now();
    db.prepare(`
      INSERT INTO store_products(id,slug,name,description,kind,price_cents,cost_cents,currency,stock_qty,active,delivery_text,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id,slug,text(req.body.name,"product name",120,2),text(req.body.description??"","description",1500),kind,price,cost,currency,kind==="physical"?stock:0,req.body.active===false?0:1,text(req.body.deliveryText??"","digital delivery",3000),stamp,stamp);
    res.status(201).json({id});
  });
  app.patch("/api/admin/store/products/:id",(req,res)=>{
    const current=db.prepare("SELECT * FROM store_products WHERE id=?").get(String(req.params.id)) as Row|undefined;
    if(!current) fail(404,"Product not found.");
    const kind=["physical","digital"].includes(req.body.kind)?req.body.kind:current.kind;
    const price=req.body.priceCents===undefined?current.price_cents:Number(req.body.priceCents);
    const cost=req.body.costCents===undefined?current.cost_cents:Number(req.body.costCents);
    const stock=req.body.stockQty===undefined?current.stock_qty:Number(req.body.stockQty);
    if(!Number.isInteger(price)||price<0||!Number.isInteger(cost)||cost<0||!Number.isInteger(stock)||stock<0) fail(400,"Check product price, cost and stock.");
    db.prepare(`
      UPDATE store_products SET name=?,description=?,kind=?,price_cents=?,cost_cents=?,currency=?,stock_qty=?,active=?,delivery_text=?,updated_at=? WHERE id=?
    `).run(
      req.body.name===undefined?current.name:text(req.body.name,"product name",120,2),
      req.body.description===undefined?current.description:text(req.body.description,"description",1500),
      kind,price,cost,
      ["XCD","USD"].includes(req.body.currency)?req.body.currency:current.currency,
      kind==="physical"?stock:0,
      req.body.active===undefined?current.active:(req.body.active?1:0),
      req.body.deliveryText===undefined?current.delivery_text:text(req.body.deliveryText,"digital delivery",3000),
      now(),current.id
    );
    res.json({ok:true});
  });

  app.get("/api/admin/store/orders",(req,res)=>{
    cleanupExpired();
    const status=String(req.query.status||"");
    if(status&&!["pending","confirmed","paid","fulfilled","cancelled"].includes(status)) fail(400,"Invalid order status.");
    const rows=db.prepare(`SELECT * FROM store_orders WHERE (?='' OR status=?) ORDER BY created_at DESC LIMIT 200`).all(status,status) as Row[];
    res.json(rows.map((order)=>({
      id:order.id,reference:order.reference,createdAt:order.created_at,status:order.status,
      customerName:order.customer_name,email:order.email,phone:order.phone,fulfillment:order.fulfillment,
      address:order.address,notes:order.notes,totalCents:order.total_cents,totalCostCents:order.total_cost_cents,
      currency:order.currency,reservationExpiresAt:order.reservation_expires_at,
      items:db.prepare("SELECT product_id AS productId,name,kind,quantity,unit_price_cents AS unitPriceCents FROM store_order_items WHERE order_id=?").all(order.id)
    })));
  });

  app.patch("/api/admin/store/orders/:id",(req,res)=>{
    cleanupExpired();
    const order=db.prepare("SELECT * FROM store_orders WHERE id=?").get(String(req.params.id)) as Row|undefined;
    if(!order) fail(404,"Order not found.");
    const next=String(req.body.status||"");
    if(!["pending","confirmed","paid","fulfilled","cancelled"].includes(next)) fail(400,"Choose a valid order status.");
    if(order.status==="fulfilled"&&next!=="fulfilled") fail(409,"A fulfilled order cannot be moved backwards.");
    if(order.status==="cancelled"&&next!=="cancelled") fail(409,"A cancelled order cannot be reopened.");
    if(next==="fulfilled"&&!["paid","fulfilled"].includes(order.status)) fail(409,"Record payment before fulfillment.");
    if(next==="cancelled"&&order.status!=="cancelled"){
      const items=db.prepare("SELECT product_id,kind,quantity FROM store_order_items WHERE order_id=?").all(order.id) as Row[];
      for(const item of items) if(item.kind==="physical") db.prepare("UPDATE store_products SET stock_qty=stock_qty+?,updated_at=? WHERE id=?").run(item.quantity,now(),item.product_id);
    }
    db.prepare("UPDATE store_orders SET status=?,payment_method=?,updated_at=? WHERE id=?")
      .run(next,text(req.body.paymentMethod??order.payment_method,"payment method",80),now(),order.id);
    res.json({ok:true});
  });

  app.get("/api/admin/store/metrics",(_req,res)=>{
    cleanupExpired();
    const sales=db.prepare("SELECT COALESCE(SUM(total_cents),0) AS revenue,COALESCE(SUM(total_cost_cents),0) AS cost,COUNT(*) AS orders FROM store_orders WHERE status IN ('paid','fulfilled')").get() as Row;
    const pending=(db.prepare("SELECT COUNT(*) AS n FROM store_orders WHERE status IN ('pending','confirmed')").get() as Row).n;
    const lowStock=db.prepare("SELECT id,name,stock_qty FROM store_products WHERE active=1 AND kind='physical' AND stock_qty<=5 ORDER BY stock_qty,name").all();
    res.json({revenueCents:sales.revenue,costCents:sales.cost,grossMarginCents:sales.revenue-sales.cost,orders:sales.orders,pending,lowStock});
  });
}
