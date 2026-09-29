import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, Minus, Plus, ShoppingCart, Store as StoreIcon, Trash2 } from 'lucide-react';
import Brand from './Brand';
import { api } from './lib/api';
import './admin.css';

type Product={id:string;slug:string;name:string;description:string;kind:'physical'|'digital';priceCents:number;currency:'XCD'|'USD';stockQty:number|null;available:boolean};
type OrderReceipt={reference:string;accessToken:string;status:string;totalCents:number;currency:'XCD'|'USD';reservationExpiresAt:string};
type OrderStatus={reference:string;status:string;createdAt:string;reservationExpiresAt:string;fulfillment:string;totalCents:number;currency:'XCD'|'USD';items:Array<{name:string;kind:string;quantity:number;unitPriceCents:number;deliveryText:string}>};
const money=(cents:number,currency:string)=>`${currency==='USD'?'US$':'EC$'}${(cents/100).toFixed(2)}`;

function OrderStatusPage({reference,token}:{reference:string;token:string}){
  const [order,setOrder]=useState<OrderStatus|null>(null);
  const [error,setError]=useState('');
  const load=()=>api<OrderStatus>(`/api/store/orders/${encodeURIComponent(reference)}/${token}`).then(setOrder).catch((e)=>setError(e instanceof Error?e.message:'Unable to load order.'));
  useEffect(()=>{load();},[reference,token]);
  if(error&&!order)return <div className="app-shell"><header className="topbar"><Brand/></header><main className="page-frame"><section className="hud-panel account-form narrow-panel"><h1>ORDER UNAVAILABLE</h1><p>{error}</p><a href="/store" className="primary-action">BACK TO STORE</a></section></main></div>;
  if(!order)return <p role="status">Loading order…</p>;
  return <div className="app-shell"><header className="topbar"><Brand/><a className="secondary-action" href="/store">STORE</a></header><main className="page-frame panel-stack">
    <section className="hud-panel account-form narrow-panel"><BadgeCheck size={40}/><p className="eyebrow">STORE ORDER / {order.reference}</p><h1>{order.status.toUpperCase()}</h1><p>Total: <strong>{money(order.totalCents,order.currency)}</strong></p><p>Fulfillment: {order.fulfillment}</p>{order.status==='pending'&&<p className="demo-note">Items are reserved until {new Date(order.reservationExpiresAt).toLocaleString()}. CombatZone will confirm payment/fulfillment arrangements.</p>}</section>
    <section className="hud-panel section-block"><div className="panel-label">ORDER ITEMS</div>{order.items.map((item)=><div className="squad-row" key={item.name}><div className="squad-name"><span>{item.kind.toUpperCase()}</span><strong>{item.name}</strong></div><span>{item.quantity} × {money(item.unitPriceCents,order.currency)}</span></div>)}</section>
    {order.status==='fulfilled'&&order.items.some((i)=>i.deliveryText)&&<section className="hud-panel section-block"><div className="panel-label">DIGITAL DELIVERY</div>{order.items.filter((i)=>i.deliveryText).map((item)=><div key={item.name}><h3>{item.name}</h3><p>{item.deliveryText}</p></div>)}</section>}
  </main></div>;
}

export default function Store(){
  const parts=window.location.pathname.split('/').filter(Boolean);
  if(parts[0]==='store'&&parts[1]==='order'&&parts[2]&&parts[3]) return <OrderStatusPage reference={parts[2]} token={parts[3]}/>;
  const [products,setProducts]=useState<Product[]>([]);
  const [cart,setCart]=useState<Record<string,number>>({});
  const [form,setForm]=useState({customerName:'',email:'',phone:'',fulfillment:'pickup',address:'',notes:''});
  const [receipt,setReceipt]=useState<OrderReceipt|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const requestKey=useRef(crypto.randomUUID());
  useEffect(()=>{api<Product[]>('/api/store/products').then(setProducts).catch((e)=>setError(e instanceof Error?e.message:'Unable to load store.'));},[]);
  const items=useMemo(()=>products.filter((p)=>cart[p.id]>0).map((p)=>({...p,quantity:cart[p.id]})),[products,cart]);
  const total=items.reduce((sum,i)=>sum+i.priceCents*i.quantity,0);
  const currency=items[0]?.currency||'XCD';
  const hasPhysical=items.some((i)=>i.kind==='physical');
  const setQty=(p:Product,delta:number)=>setCart((current)=>{
    const max=p.kind==='physical'?Math.max(0,p.stockQty||0):20;
    const next=Math.max(0,Math.min(max,(current[p.id]||0)+delta));
    const copy={...current}; if(next)copy[p.id]=next;else delete copy[p.id]; return copy;
  });
  async function checkout(e:FormEvent){
    e.preventDefault();if(!items.length)return;setBusy(true);setError('');
    try{
      const result=await api<OrderReceipt>('/api/store/orders',{method:'POST',headers:{'Idempotency-Key':requestKey.current},body:JSON.stringify({...form,fulfillment:hasPhysical?form.fulfillment:'digital',items:items.map((i)=>({productId:i.id,quantity:i.quantity}))})});
      setReceipt(result);setCart({});
    }catch(err){setError(err instanceof Error?err.message:'Could not place order.');}
    finally{setBusy(false);}
  }
  if(receipt){
    const link=`/store/order/${receipt.reference}/${receipt.accessToken}`;
    return <div className="app-shell"><header className="topbar"><Brand/></header><main className="page-frame"><section className="hud-panel account-form narrow-panel"><BadgeCheck size={42}/><p className="eyebrow">ORDER RECEIVED</p><h1>{receipt.reference}</h1><p>Your order total is <strong>{money(receipt.totalCents,receipt.currency)}</strong>. No card details were collected. CombatZone will confirm payment and fulfillment arrangements.</p><a className="primary-action" href={link}>TRACK MY ORDER</a><a className="secondary-action" href="/store">CONTINUE SHOPPING</a></section></main></div>;
  }
  return <div className="app-shell"><header className="topbar"><Brand/><a className="secondary-action" href="/">COMBATZONE HOME</a></header><main className="page-frame panel-stack">
    <section className="hud-panel section-block"><p className="eyebrow"><StoreIcon size={15}/> COMBATZONE STORE</p><h1>GEAR. GIFTS. DIGITAL EXTRAS.</h1><p>Order physical CombatZone merchandise and digital products. Physical stock is reserved for 24 hours after checkout while payment and fulfillment are confirmed.</p>{error&&<p className="prototype-warning">{error}</p>}</section>
    <section className="mission-grid">{products.map((p)=><article className="mission-card" key={p.id}><div className="mission-card-top"><div><span className="call-sign">{p.kind.toUpperCase()}</span><h2>{p.name}</h2></div><StoreIcon size={20}/></div><p>{p.description}</p><div className="mission-card-footer"><div><span className="meta-label">PRICE</span><strong>{money(p.priceCents,p.currency)}</strong></div><div><span className="meta-label">{p.kind==='physical'?'STOCK':'DELIVERY'}</span><strong>{p.kind==='physical'?p.stockQty:'DIGITAL'}</strong></div></div><div className="nav-actions"><button className="secondary-action" disabled={!cart[p.id]} onClick={()=>setQty(p,-1)}><Minus size={15}/></button><strong>{cart[p.id]||0}</strong><button className="primary-action" disabled={!p.available} onClick={()=>setQty(p,1)}><Plus size={15}/> ADD</button></div></article>)}</section>
    <form className="hud-panel account-form" onSubmit={checkout}><div className="panel-label"><ShoppingCart size={15}/> CART & CHECKOUT</div>
      {!items.length?<p>Your cart is empty.</p>:<>{items.map((i)=><div className="squad-row" key={i.id}><div className="squad-name"><span>{i.kind.toUpperCase()}</span><strong>{i.name}</strong></div><span>{i.quantity} × {money(i.priceCents,i.currency)}</span><button type="button" className="admin-icon-button" onClick={()=>setCart((c)=>{const n={...c};delete n[i.id];return n;})}><Trash2 size={15}/></button></div>)}<div className="brief-total"><span>ORDER TOTAL</span><strong>{money(total,currency)}</strong></div></>}
      <label><span>Name</span><input required maxLength={120} value={form.customerName} onChange={(e)=>setForm({...form,customerName:e.target.value})}/></label>
      <label><span>Email</span><input required type="email" maxLength={254} value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></label>
      <label><span>Phone / WhatsApp</span><input required type="tel" maxLength={30} value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/></label>
      {hasPhysical&&<label><span>Fulfillment</span><select value={form.fulfillment} onChange={(e)=>setForm({...form,fulfillment:e.target.value})}><option value="pickup">Pickup</option><option value="delivery">Local delivery</option></select></label>}
      {hasPhysical&&form.fulfillment==='delivery'&&<label><span>Delivery address</span><textarea required maxLength={500} rows={3} value={form.address} onChange={(e)=>setForm({...form,address:e.target.value})}/></label>}
      <label><span>Order notes</span><textarea maxLength={1000} rows={3} value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})} placeholder="Size, color, event reference, pickup notes…"/></label>
      <p className="demo-note">No payment card details are collected on this website. CombatZone will confirm the payment method and fulfillment after reviewing the order.</p>
      <button className="primary-action" disabled={busy||!items.length}>{busy?'PLACING ORDER…':'PLACE ORDER'}</button>
    </form>
  </main></div>;
}
