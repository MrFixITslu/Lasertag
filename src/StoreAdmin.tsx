import { FormEvent, useEffect, useState } from 'react';
import { PackagePlus, RefreshCw, Store as StoreIcon } from 'lucide-react';
import { api } from './lib/api';
import type { AdminSession } from './BusinessConsole';

type Product={id:string;slug:string;name:string;description:string;kind:string;price_cents:number;cost_cents:number;currency:string;stock_qty:number;active:number;delivery_text:string};
type Order={id:string;reference:string;createdAt:string;status:string;customerName:string;email:string;phone:string;fulfillment:string;address:string;notes:string;totalCents:number;totalCostCents:number;currency:string;items:Array<{name:string;kind:string;quantity:number;unitPriceCents:number}>};
type Metrics={byCurrency:Array<{currency:string;revenueCents:number;costCents:number;grossMarginCents:number;orders:number}>;pending:number;lowStock:Array<{id:string;name:string;stock_qty:number}>};
const money=(c:number,cur='XCD')=>`${cur==='USD'?'US$':'EC$'}${(c/100).toFixed(2)}`;

export default function StoreAdmin({session}:{session:AdminSession}){
  const [products,setProducts]=useState<Product[]>([]);
  const [orders,setOrders]=useState<Order[]>([]);
  const [metrics,setMetrics]=useState<Metrics|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [form,setForm]=useState({slug:'',name:'',description:'',kind:'physical',price:'',cost:'',currency:'XCD',stock:'0',deliveryText:''});
  const headers={'X-CSRF-Token':session.csrf};
  const load=async()=>{setError('');try{const [p,o,m]=await Promise.all([api<Product[]>('/api/admin/store/products'),api<Order[]>('/api/admin/store/orders'),api<Metrics>('/api/admin/store/metrics')]);setProducts(p);setOrders(o);setMetrics(m);}catch(e){setError(e instanceof Error?e.message:'Could not load store management.');}};
  useEffect(()=>{load();},[]);
  async function create(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/api/admin/store/products',{method:'POST',headers,body:JSON.stringify({slug:form.slug,name:form.name,description:form.description,kind:form.kind,priceCents:Math.round(Number(form.price)*100),costCents:Math.round(Number(form.cost||0)*100),currency:form.currency,stockQty:Number(form.stock||0),deliveryText:form.deliveryText})});setForm({slug:'',name:'',description:'',kind:'physical',price:'',cost:'',currency:'XCD',stock:'0',deliveryText:''});setNotice('Product created.');await load();}catch(err){setError(err instanceof Error?err.message:'Could not create product.');}finally{setBusy(false);}}
  async function patchProduct(p:Product,patch:any){setBusy(true);try{await api(`/api/admin/store/products/${p.id}`,{method:'PATCH',headers,body:JSON.stringify(patch)});await load();}catch(e){setError(e instanceof Error?e.message:'Could not update product.');}finally{setBusy(false);}}
  async function patchOrder(o:Order,status:string){setBusy(true);try{await api(`/api/admin/store/orders/${o.id}`,{method:'PATCH',headers,body:JSON.stringify({status,paymentMethod:status==='paid'?'Recorded by staff':'pending'})});setNotice(`Order ${o.reference} updated.`);await load();}catch(e){setError(e instanceof Error?e.message:'Could not update order.');}finally{setBusy(false);}}
  return <section className="business-panel hud-panel">
    <div className="admin-panel-header"><span><StoreIcon size={16}/> STORE MANAGEMENT</span><button className="admin-text-button" onClick={load}><RefreshCw size={14}/> Refresh</button></div>
    {metrics&&<><div className="admin-stats">{metrics.byCurrency.length?metrics.byCurrency.flatMap((row)=>[
      <div key={`${row.currency}-revenue`}><span>{row.currency} revenue</span><strong>{money(row.revenueCents,row.currency)}</strong></div>,
      <div key={`${row.currency}-margin`}><span>{row.currency} gross margin</span><strong>{money(row.grossMarginCents,row.currency)}</strong></div>
    ]):<div><span>Paid/Fulfilled</span><strong>0</strong></div>}<div><span>Pending</span><strong>{metrics.pending}</strong></div></div></>}
    {metrics?.lowStock.length?<p className="prototype-warning">Low stock: {metrics.lowStock.map((p)=>`${p.name} (${p.stock_qty})`).join(' · ')}</p>:null}
    {notice&&<p className="demo-note">{notice}</p>}{error&&<p className="prototype-warning" role="alert">{error}</p>}
    <form className="admin-edit" onSubmit={create}><h3><PackagePlus size={15}/> ADD PRODUCT</h3><div className="admin-edit-grid">
      <label>Name<input required maxLength={120} value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label>
      <label>Slug<input required maxLength={80} value={form.slug} onChange={(e)=>setForm({...form,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')})}/></label>
      <label>Type<select value={form.kind} onChange={(e)=>setForm({...form,kind:e.target.value})}><option value="physical">Physical</option><option value="digital">Digital</option></select></label>
      <label>Currency<select value={form.currency} onChange={(e)=>setForm({...form,currency:e.target.value})}><option>XCD</option><option>USD</option></select></label>
      <label>Price<input required type="number" step="0.01" min="0" value={form.price} onChange={(e)=>setForm({...form,price:e.target.value})}/></label>
      <label>Cost<input type="number" step="0.01" min="0" value={form.cost} onChange={(e)=>setForm({...form,cost:e.target.value})}/></label>
      {form.kind==='physical'&&<label>Stock<input type="number" min="0" value={form.stock} onChange={(e)=>setForm({...form,stock:e.target.value})}/></label>}
    </div><label>Description<textarea maxLength={1500} rows={2} value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})}/></label>{form.kind==='digital'&&<label>Digital delivery instructions / link<textarea maxLength={3000} rows={3} value={form.deliveryText} onChange={(e)=>setForm({...form,deliveryText:e.target.value})}/></label>}<button className="primary-action" disabled={busy}>CREATE PRODUCT</button></form>
    <h3>PRODUCTS</h3><div className="business-table"><table><thead><tr><th>Product</th><th>Type</th><th>Price</th><th>Cost</th><th>Stock</th><th>Live</th></tr></thead><tbody>{products.map((p)=><tr key={p.id}><td>{p.name}</td><td>{p.kind}</td><td>{money(p.price_cents,p.currency)}</td><td>{money(p.cost_cents,p.currency)}</td><td>{p.kind==='physical'?<input style={{width:80}} type="number" min="0" value={p.stock_qty} onChange={(e)=>setProducts((rows)=>rows.map((x)=>x.id===p.id?{...x,stock_qty:Number(e.target.value)}:x))} onBlur={()=>patchProduct(p,{stockQty:p.stock_qty})}/>: '∞'}</td><td><input type="checkbox" checked={Boolean(p.active)} onChange={(e)=>patchProduct(p,{active:e.target.checked})}/></td></tr>)}</tbody></table></div>
    <h3>ORDERS</h3><div className="business-table"><table><thead><tr><th>Reference</th><th>Customer</th><th>Total</th><th>Fulfillment</th><th>Status</th></tr></thead><tbody>{orders.map((o)=><tr key={o.id}><td>{o.reference}<br/><small>{o.items.map((i)=>`${i.quantity}× ${i.name}`).join(', ')}</small></td><td>{o.customerName}<br/><small>{o.email} · {o.phone}</small></td><td>{money(o.totalCents,o.currency)}</td><td>{o.fulfillment}{o.address&&<><br/><small>{o.address}</small></>}</td><td><select value={o.status} disabled={busy||['fulfilled','cancelled'].includes(o.status)} onChange={(e)=>patchOrder(o,e.target.value)}><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="paid">Paid</option><option value="fulfilled">Fulfilled</option><option value="cancelled">Cancelled</option></select></td></tr>)}</tbody></table></div>
  </section>;
}
