import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";

type Row = Record<string, any>;
type Helpers = {
  fail: (status:number,message:string)=>never;
  text: (value:unknown,name:string,max:number,min?:number)=>string;
};
const now=()=>new Date().toISOString();
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const money=(value:number)=>Math.round(value);

export function installStore(app:Express,db:DatabaseSync,helpers:Helpers,linkSecret:string){
  const {fail,text}=helpers;
  const tokenKey=createHash("sha256").update(linkSecret).digest();
  const seal=(value:string)=>{
    const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",tokenKey,iv);
    const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
    return "v1:"+iv.toString("base64url")+":"+cipher.getAuthTag().toString("base64url")+":"+encrypted.toString("base64url");
  };
  const open=(value:unknown)=>{
    if(typeof value!=="string"||!value)return "";
    const parts=value.split(":");
    if(parts.length!==4||parts[0]!=="v1")return "";
    try{
      const decipher=createDecipheriv("aes-256-gcm",tokenKey,Buffer.from(parts[1],"base64url"));
      decipher.setAuthTag(Buffer.from(parts[2],"base64url"));
      return Buffer.concat([decipher.update(Buffer.from(parts[3],"base64url")),decipher.final()]).toString("utf8");
    }catch{return "";}
  };
  const required=<T>(value:T|undefined,message:string):T=>{
    if(!value) fail(404,message);
    return value as T;
  };
  const adminOnly=(_req:Request,res:Response,next:NextFunction)=>
    res.locals.user?.role==="admin"
      ? next()
      : next(Object.assign(new Error("Admin access required."),{status:403}));
  const finance = (_req:Request,res:Response,next:NextFunction) =>
    res.locals.user?.role === "admin" || Boolean(res.locals.user?.finance)
      ? next()
      : next(Object.assign(new Error("Finance access required."),{status:403}));
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
      access_value TEXT NOT NULL DEFAULT '',
      request_key TEXT UNIQUE NOT NULL,
      request_hash TEXT NOT NULL DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS store_order_payments(
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
      cents INTEGER NOT NULL CHECK(cents>0),
      kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),
      method TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      request_key TEXT UNIQUE NOT NULL
    );
    CREATE INDEX IF NOT EXISTS store_order_payments_order ON store_order_payments(order_id,created_at);
    CREATE INDEX IF NOT EXISTS store_orders_status_date ON store_orders(status,created_at);
  `);

  const orderColumns=db.prepare("PRAGMA table_info(store_orders)").all() as Row[];
  if(!orderColumns.some((column)=>column.name==="access_value"))
    db.exec("ALTER TABLE store_orders ADD COLUMN access_value TEXT NOT NULL DEFAULT ''");
  if(!orderColumns.some((column)=>column.name==="request_hash"))
    db.exec("ALTER TABLE store_orders ADD COLUMN request_hash TEXT NOT NULL DEFAULT ''");

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
    const requestHash=digest(JSON.stringify(req.body));
    const existing=db.prepare("SELECT reference,access_value,request_hash,status,total_cents,currency,reservation_expires_at FROM store_orders WHERE request_key=?").get(requestKey) as Row|undefined;
    if(existing){
      if(existing.request_hash!==requestHash) fail(409,"This order request identifier was already used for different details.");
      const accessToken=open(existing.access_value);
      if(!accessToken) fail(409,"This order was already submitted. Use the original order link or contact CombatZone.");
      return res.json({
        reference:existing.reference,accessToken,status:existing.status,totalCents:existing.total_cents,
        currency:existing.currency,reservationExpiresAt:existing.reservation_expires_at,replayed:true
      });
    }
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
        INSERT INTO store_orders(id,reference,access_hash,access_value,request_key,request_hash,created_at,updated_at,reservation_expires_at,status,
          customer_name,email,phone,fulfillment,address,notes,total_cents,total_cost_cents,currency)
        VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?)
      `).run(
        id,reference,digest(accessToken),seal(accessToken),requestKey,requestHash,now(),now(),expires,
        customerName,email,phone,fulfillment,address,notes,total,cost,rows[0].currency
      );
      for(const p of rows){
        const qty=requested.get(p.id)!;
        db.prepare("INSERT INTO store_order_items(order_id,product_id,name,kind,quantity,unit_price_cents,unit_cost_cents) VALUES(?,?,?,?,?,?,?)")
          .run(id,p.id,p.name,p.kind,qty,p.price_cents,p.cost_cents);
        if(p.kind==="physical"){
          const updated=db.prepare("UPDATE store_products SET stock_qty=stock_qty-?,updated_at=? WHERE id=? AND stock_qty>=?")
            .run(qty,now(),p.id,qty);
          if(!updated.changes) fail(409,`${p.name} no longer has enough stock for that quantity.`);
        }
      }
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
    res.status(201).json({reference,accessToken,status:"pending",totalCents:total,currency:rows[0].currency,reservationExpiresAt:expires});
  });

  app.get("/api/store/orders/:reference/:token",(req,res)=>{
    cleanupExpired();
    const order=required(
      db.prepare("SELECT * FROM store_orders WHERE reference=? AND access_hash=?")
        .get(String(req.params.reference),digest(String(req.params.token))) as Row|undefined,
      "Store order not found."
    );
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

  app.get("/api/admin/store/products",adminOnly,(_req,res)=>{
    res.json(db.prepare("SELECT * FROM store_products ORDER BY active DESC,kind,name").all());
  });
  app.post("/api/admin/store/products",adminOnly,(req,res)=>{
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
  app.patch("/api/admin/store/products/:id",adminOnly,(req,res)=>{
    const current=required(
      db.prepare("SELECT * FROM store_products WHERE id=?").get(String(req.params.id)) as Row|undefined,
      "Product not found."
    );
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

  const paymentBalance=(orderId:string)=>{
    const rows=db.prepare("SELECT cents,kind FROM store_order_payments WHERE order_id=?").all(orderId) as Row[];
    const paid=rows.filter((row)=>row.kind==="payment").reduce((sum,row)=>sum+Number(row.cents),0);
    const refunded=rows.filter((row)=>row.kind==="refund").reduce((sum,row)=>sum+Number(row.cents),0);
    return {paid,refunded,net:paid-refunded};
  };

  app.get("/api/admin/store/orders",finance,(req,res)=>{
    cleanupExpired();
    const status=String(req.query.status||"");
    if(status&&!["pending","confirmed","paid","fulfilled","cancelled"].includes(status)) fail(400,"Invalid order status.");
    const rows=db.prepare(`SELECT * FROM store_orders WHERE (?='' OR status=?) ORDER BY created_at DESC LIMIT 200`).all(status,status) as Row[];
    res.json(rows.map((order)=>({
      id:order.id,reference:order.reference,createdAt:order.created_at,status:order.status,
      customerName:order.customer_name,email:order.email,phone:order.phone,fulfillment:order.fulfillment,
      address:order.address,notes:order.notes,totalCents:order.total_cents,totalCostCents:order.total_cost_cents,
      currency:order.currency,reservationExpiresAt:order.reservation_expires_at,
      payment:paymentBalance(order.id),
      items:db.prepare("SELECT product_id AS productId,name,kind,quantity,unit_price_cents AS unitPriceCents FROM store_order_items WHERE order_id=?").all(order.id)
    })));
  });

  app.patch("/api/admin/store/orders/:id",finance,(req,res)=>{
    cleanupExpired();
    const order=required(
      db.prepare("SELECT * FROM store_orders WHERE id=?").get(String(req.params.id)) as Row|undefined,
      "Order not found."
    );
    const next=String(req.body.status||"");
    if(!["pending","confirmed","paid","fulfilled","cancelled"].includes(next)) fail(400,"Choose a valid order status.");
    if(order.status==="fulfilled"&&next!=="fulfilled") fail(409,"A fulfilled order cannot be moved backwards.");
    if(order.status==="cancelled"&&next!=="cancelled") fail(409,"A cancelled order cannot be reopened.");
    const balance=paymentBalance(order.id);
    if(next==="paid"&&balance.net<order.total_cents) fail(409,"Record the full payment before marking this order paid.");
    if(next==="fulfilled"&&balance.net<order.total_cents) fail(409,"Record the full payment before fulfillment.");
    if(next==="cancelled"&&balance.net>0) fail(409,"Refund recorded payments before cancelling this order.");
    if(next==="cancelled"&&order.status!=="cancelled"){
      const items=db.prepare("SELECT product_id,kind,quantity FROM store_order_items WHERE order_id=?").all(order.id) as Row[];
      for(const item of items) if(item.kind==="physical") db.prepare("UPDATE store_products SET stock_qty=stock_qty+?,updated_at=? WHERE id=?").run(item.quantity,now(),item.product_id);
    }
    db.prepare("UPDATE store_orders SET status=?,payment_method=?,updated_at=? WHERE id=?")
      .run(next,text(req.body.paymentMethod??order.payment_method,"payment method",80),now(),order.id);
    res.json({ok:true});
  });

  app.post("/api/admin/store/orders/:id/payments",finance,(req,res)=>{
    cleanupExpired();
    const order=required(
      db.prepare("SELECT * FROM store_orders WHERE id=?").get(String(req.params.id)) as Row|undefined,
      "Order not found."
    );
    if(order.status==="cancelled") fail(409,"Cancelled orders cannot receive payments.");
    const requestKey=String(req.get("Idempotency-Key")||"");
    if(!/^[a-f0-9-]{36}$/i.test(requestKey)) fail(400,"Missing payment request identifier.");
    const existing=db.prepare("SELECT id FROM store_order_payments WHERE request_key=?").get(requestKey) as Row|undefined;
    if(existing) return res.json({ok:true,replayed:true,...paymentBalance(order.id)});
    const kind=req.body.kind==="refund"?"refund":req.body.kind==="payment"?"payment":"";
    if(!kind) fail(400,"Choose payment or refund.");
    const cents=Number(req.body.cents);
    if(!Number.isInteger(cents)||cents<=0||cents>100_000_000) fail(400,"Enter a valid payment amount.");
    const current=paymentBalance(order.id);
    if(kind==="refund"&&cents>current.net) fail(409,"Refund cannot exceed the net amount paid.");
    db.prepare("INSERT INTO store_order_payments(id,order_id,cents,kind,method,note,actor,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        randomUUID(),order.id,cents,kind,text(req.body.method??"manual","payment method",80,2),
        text(req.body.note??"","payment note",500),res.locals.user.id,now(),requestKey
      );
    const next=paymentBalance(order.id);
    if(kind==="payment"&&next.net>=order.total_cents&&["pending","confirmed"].includes(order.status))
      db.prepare("UPDATE store_orders SET status='paid',payment_method=?,updated_at=? WHERE id=?")
        .run(text(req.body.method??"manual","payment method",80,2),now(),order.id);
    res.status(201).json({ok:true,...next});
  });

  app.get("/api/admin/store/orders/:id/payments",finance,(req,res)=>{
    const order=required(
      db.prepare("SELECT id FROM store_orders WHERE id=?").get(String(req.params.id)) as Row|undefined,
      "Order not found."
    );
    res.json({
      ...paymentBalance(order.id),
      rows:db.prepare("SELECT id,cents,kind,method,note,actor,created_at AS createdAt FROM store_order_payments WHERE order_id=? ORDER BY created_at DESC").all(order.id)
    });
  });

  app.get("/api/admin/store/metrics",finance,(_req,res)=>{
    cleanupExpired();
    const currencies=db.prepare("SELECT DISTINCT currency FROM store_orders ORDER BY currency").all() as Row[];
    const byCurrency=currencies.map(({currency})=>{
      const orders=db.prepare("SELECT id,total_cost_cents,status FROM store_orders WHERE currency=?").all(currency) as Row[];
      const netCash=orders.reduce((sum,order)=>sum+paymentBalance(order.id).net,0);
      const recognizedCost=orders
        .filter((order)=>["paid","fulfilled"].includes(order.status)&&paymentBalance(order.id).net>0)
        .reduce((sum,order)=>sum+Number(order.total_cost_cents),0);
      return {
        currency,
        revenueCents:netCash,
        costCents:recognizedCost,
        grossMarginCents:netCash-recognizedCost,
        orders:orders.filter((order)=>paymentBalance(order.id).net>0).length
      };
    });
    const pending=(db.prepare("SELECT COUNT(*) AS n FROM store_orders WHERE status IN ('pending','confirmed')").get() as Row).n;
    const lowStock=db.prepare("SELECT id,name,stock_qty FROM store_products WHERE active=1 AND kind='physical' AND stock_qty<=5 ORDER BY stock_qty,name").all();
    res.json({byCurrency,pending,lowStock});
  });
}
