import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { buildDateChoices } from "../src/lib/booking";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

const password="platform-test-password-long-enough";
const origin="http://localhost:5173";
const cleanups:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()!();});

async function start(){
  const {app,db}=createApp({
    databasePath:":memory:",
    adminUsername:"admin",
    adminPassword:password,
    linkSecret:"separate-platform-link-secret-for-tests",
    publicOrigin:origin,
    secureCookies:false,
    staticPath:"public",
  });
  const server=await new Promise<Server>((resolve)=>{
    const listener=app.listen(0,"127.0.0.1",()=>resolve(listener));
  });
  const address=server.address() as {port:number};
  const base=`http://127.0.0.1:${address.port}`;
  const request=(path:string,method="GET",body?:unknown,headers:Record<string,string>={})=>
    fetch(base+path,{
      method,
      headers:{
        Origin:origin,
        ...(body===undefined?{}:{"Content-Type":"application/json"}),
        ...headers,
      },
      body:body===undefined?undefined:JSON.stringify(body),
    });
  const login=async()=>{
    const response=await request("/api/admin/login","POST",{username:"admin",password});
    expect(response.status).toBe(200);
    const cookie=response.headers.get("set-cookie")!.split(";")[0];
    const session=await response.json();
    return {Cookie:cookie,"X-CSRF-Token":session.csrf};
  };
  const close=async()=>{await new Promise<void>((resolve,reject)=>server.close((e)=>e?reject(e):resolve()));db.close();};
  cleanups.push(close);
  return {request,login,db};
}
function eventDraft(overrides:Record<string,unknown>={}){
  return {
    missionId:"school-youth-battle",
    players:6,
    date:buildDateChoices(5)[4].value,
    time:"09:00",
    venueType:"community",
    area:"Gros Islet",
    address:"Community field",
    weatherFlexible:false,
    notes:"",
    eventDetails:{
      eventName:"Youth Mission",
      organization:"Test Club",
      groupType:"school",
      ageGroup:"children",
      emergencyContactName:"Parent Lead",
      emergencyContactPhone:"+17585550000",
      objectives:"Fun and teamwork",
      accessibilityNotes:"",
      photoConsent:false,
      participantNames:[],
    },
    customer:{
      fullName:"Organizer",
      email:"organizer@example.com",
      phone:"+17585551111",
      marketingOptIn:false,
    },
    ...overrides,
  };
}
const idem=()=>({"Idempotency-Key":randomUUID()});

describe("CombatZone platform end-to-end and security",()=>{
  it("runs booking, self-registration, youth check-in, team lock and feedback with encrypted bearer secrets",async()=>{
    const service=await start();
    const booked=await service.request("/api/bookings","POST",eventDraft(),idem());
    expect(booked.status).toBe(201);
    const receipt=await booked.json();
    expect(receipt.portalToken).toMatch(/^[a-f0-9]{64}$/);

    const portalRow=service.db.prepare("SELECT token_hash,token_value FROM booking_portals").get() as any;
    expect(portalRow.token_value).toMatch(/^v1:/);
    expect(portalRow.token_value).not.toContain(receipt.portalToken);

    const portalResponse=await service.request(`/api/portal/${receipt.portalToken}`);
    expect(portalResponse.status).toBe(200);
    expect(portalResponse.headers.get("cache-control")).toContain("no-store");
    expect(portalResponse.headers.get("referrer-policy")).toBe("no-referrer");
    expect(portalResponse.headers.get("x-robots-tag")).toContain("noindex");
    const portal=await portalResponse.json();
    expect(portal.registrationUrl).toBe("");
    expect(portal.joinUrl).toContain("/join/");
    const joinToken=portal.joinUrl.split("/").pop()!;

    const inviteRow=service.db.prepare("SELECT token_value FROM participant_invites").get() as any;
    expect(inviteRow.token_value).toMatch(/^v1:/);
    expect(inviteRow.token_value).not.toContain(joinToken);

    expect((await service.request(
      `/api/join/${joinToken}`,"POST",
      {name:"Child One",safetyAcknowledged:true,guardianName:"Parent One",guardianPhone:"+17585552222"},
      {Origin:"https://attacker.example"},
    )).status).toBe(403);

    const joined=await service.request(`/api/join/${joinToken}`,"POST",{
      name:"Child One",
      safetyAcknowledged:false,
      guardianName:"",
      guardianPhone:"",
    });
    expect(joined.status).toBe(201);
    const joinResult=await joined.json();
    const checkToken=joinResult.checkInUrl.split("/").pop()!;
    expect(checkToken).toMatch(/^[a-f0-9]{48}$/);
    const participantRow=service.db.prepare("SELECT checkin_hash,checkin_value FROM participants").get() as any;
    expect(participantRow.checkin_value).toMatch(/^v1:/);
    expect(participantRow.checkin_value).not.toContain(checkToken);

    expect((await service.request(`/api/checkin/${checkToken}`,"POST",{
      safetyAcknowledged:true,guardianName:"",guardianPhone:"",
    })).status).toBe(400);
    expect((await service.request(`/api/checkin/${checkToken}`,"POST",{
      safetyAcknowledged:true,guardianName:"Parent One",guardianPhone:"+17585552222",
    })).status).toBe(200);

    const auth=await service.login();
    const list=await (await service.request("/api/admin/bookings","GET",undefined,auth)).json();
    const bookingId=list.bookings[0].id;
    const event=await (await service.request(`/api/admin/events/${bookingId}`,"GET",undefined,auth)).json();
    expect(event.participants[0].checkedIn).toBe(true);
    expect(event.participants[0].waiverSigned).toBe(true);

    expect((await service.request(`/api/admin/events/${bookingId}/lock`,"POST",{locked:true},auth)).status).toBe(200);
    expect((await service.request(`/api/join/${joinToken}`,"POST",{
      name:"Blocked Child",safetyAcknowledged:true,guardianName:"Parent",guardianPhone:"+17585553333",
    })).status).toBe(409);

    expect((await service.request(`/api/admin/events/${bookingId}/status`,"POST",{status:"complete"},auth)).status).toBe(200);
    expect((await service.request(`/api/portal/${receipt.portalToken}/feedback`,"POST",{
      rating:5,comment:"Great event",
    })).status).toBe(201);
    const complete=await (await service.request(`/api/portal/${receipt.portalToken}`)).json();
    expect(complete.feedback[0].rating).toBe(5);

    expect((await service.request(`/api/admin/events/${bookingId}/costs`)).status).toBe(401);
    const cost=await service.request(`/api/admin/events/${bookingId}/costs`,"POST",{
      category:"staffing",cents:12000,note:"Marshal time",
    },auth);
    expect(cost.status).toBe(201);
    expect((await cost.json()).totalCents).toBe(12000);
  });

  it("runs store inventory, idempotent checkout, payment, fulfillment and refund safeguards",async()=>{
    const service=await start();
    const auth=await service.login();

    const createProduct=async(body:Record<string,unknown>)=>{
      const response=await service.request("/api/admin/store/products","POST",body,auth);
      expect(response.status).toBe(201);
      return (await response.json()).id as string;
    };
    const physicalId=await createProduct({
      slug:"test-shirt",name:"Test Shirt",description:"Physical test item",kind:"physical",
      priceCents:6500,costCents:3000,currency:"XCD",stockQty:3,deliveryText:"",
    });
    const digitalId=await createProduct({
      slug:"test-digital",name:"Digital Pack",description:"Digital test item",kind:"digital",
      priceCents:3500,costCents:500,currency:"XCD",stockQty:0,deliveryText:"https://example.invalid/private-download",
    });

    const publicProducts=await (await service.request("/api/store/products")).json();
    expect(publicProducts).toHaveLength(2);
    expect(publicProducts[0]).not.toHaveProperty("cost_cents");
    expect(publicProducts[0]).not.toHaveProperty("delivery_text");

    const orderBody={
      customerName:"Store Customer",email:"buyer@example.com",phone:"+17585554444",
      fulfillment:"pickup",address:"",notes:"Large shirt",
      items:[{productId:physicalId,quantity:2}],
    };
    const requestKey=idem();
    const first=await service.request("/api/store/orders","POST",orderBody,requestKey);
    expect(first.status).toBe(201);
    const receipt=await first.json();
    expect(receipt.accessToken).toMatch(/^[a-f0-9]{64}$/);

    const replay=await service.request("/api/store/orders","POST",orderBody,requestKey);
    expect(replay.status).toBe(200);
    const replayReceipt=await replay.json();
    expect(replayReceipt.reference).toBe(receipt.reference);
    expect(replayReceipt.accessToken).toBe(receipt.accessToken);
    expect(replayReceipt.replayed).toBe(true);

    const dbOrder=service.db.prepare("SELECT access_hash,access_value,request_hash FROM store_orders WHERE reference=?").get(receipt.reference) as any;
    expect(dbOrder.access_value).toMatch(/^v1:/);
    expect(dbOrder.access_value).not.toContain(receipt.accessToken);
    expect(dbOrder.request_hash).toMatch(/^[a-f0-9]{64}$/);
    const stock=(service.db.prepare("SELECT stock_qty FROM store_products WHERE id=?").get(physicalId) as any).stock_qty;
    expect(stock).toBe(1);

    expect((await service.request(`/api/store/orders/${receipt.reference}/bad-token`)).status).toBe(404);
    expect((await service.request(`/api/store/orders/${receipt.reference}/${receipt.accessToken}`)).status).toBe(200);

    const orders=await (await service.request("/api/admin/store/orders","GET",undefined,auth)).json();
    const order=orders.find((item:any)=>item.reference===receipt.reference);
    expect(order.payment.net).toBe(0);
    expect((await service.request(`/api/admin/store/orders/${order.id}`,"PATCH",{status:"fulfilled"},auth)).status).toBe(409);

    const payKey=idem();
    const payment=await service.request(`/api/admin/store/orders/${order.id}/payments`,"POST",{
      kind:"payment",cents:13000,method:"cash",note:"Paid in full",
    },{...auth,...payKey});
    expect(payment.status).toBe(201);
    expect((await payment.json()).net).toBe(13000);
    const paymentReplay=await service.request(`/api/admin/store/orders/${order.id}/payments`,"POST",{
      kind:"payment",cents:13000,method:"cash",note:"Paid in full",
    },{...auth,...payKey});
    expect(paymentReplay.status).toBe(200);
    expect((await paymentReplay.json()).net).toBe(13000);

    const refreshed=(await (await service.request("/api/admin/store/orders","GET",undefined,auth)).json())
      .find((item:any)=>item.id===order.id);
    expect(refreshed.status).toBe("paid");
    expect((await service.request(`/api/admin/store/orders/${order.id}`,"PATCH",{status:"cancelled"},auth)).status).toBe(409);
    expect((await service.request(`/api/admin/store/orders/${order.id}`,"PATCH",{status:"fulfilled"},auth)).status).toBe(200);
    expect((await service.request(`/api/admin/store/orders/${order.id}`,"PATCH",{status:"confirmed"},auth)).status).toBe(409);

    const digitalBody={
      customerName:"Digital Buyer",email:"digital@example.com",phone:"+17585556666",
      fulfillment:"digital",address:"",notes:"",
      items:[{productId:digitalId,quantity:1}],
    };
    const digitalReceipt=await (await service.request("/api/store/orders","POST",digitalBody,idem())).json();
    const before=await (await service.request(`/api/store/orders/${digitalReceipt.reference}/${digitalReceipt.accessToken}`)).json();
    expect(before.items[0].deliveryText).toBe("");
    const digitalOrder=(await (await service.request("/api/admin/store/orders","GET",undefined,auth)).json())
      .find((item:any)=>item.reference===digitalReceipt.reference);
    await service.request(`/api/admin/store/orders/${digitalOrder.id}/payments`,"POST",{
      kind:"payment",cents:3500,method:"transfer",note:"",
    },{...auth,...idem()});
    expect((await service.request(`/api/admin/store/orders/${digitalOrder.id}`,"PATCH",{status:"fulfilled"},auth)).status).toBe(200);
    const after=await (await service.request(`/api/store/orders/${digitalReceipt.reference}/${digitalReceipt.accessToken}`)).json();
    expect(after.items[0].deliveryText).toContain("private-download");

    const metrics=await (await service.request("/api/admin/store/metrics","GET",undefined,auth)).json();
    expect(metrics.byCurrency.find((row:any)=>row.currency==="XCD").revenueCents).toBe(16500);
  });

  it("enforces sensitive-route browser protections and admin boundaries",async()=>{
    const service=await start();
    expect((await service.request("/api/admin/store/products")).status).toBe(401);
    expect((await service.request("/api/admin/events/fake/costs")).status).toBe(401);

    const booked=await service.request("/api/bookings","POST",eventDraft(),idem());
    const receipt=await booked.json();
    const apiResponse=await service.request(`/api/portal/${receipt.portalToken}`);
    expect(apiResponse.headers.get("referrer-policy")).toBe("no-referrer");
    expect(apiResponse.headers.get("cache-control")).toContain("no-store");
    expect(apiResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(apiResponse.headers.get("x-frame-options")).toBe("DENY");
    expect(apiResponse.headers.get("permissions-policy")).toContain("camera=()");
    expect(apiResponse.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(apiResponse.headers.get("x-robots-tag")).toContain("noindex");

    expect((await service.request(
      `/api/portal/${receipt.portalToken}/profile`,"PUT",
      eventDraft().eventDetails,
      {Origin:"https://attacker.invalid"},
    )).status).toBe(403);
  });
});
