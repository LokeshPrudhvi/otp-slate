import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {createAuth} from './auth.js';
import {migration} from './migration.js';
import * as schema from './schema.js';

test('Expo sessions use the existing credentials, reject foreign schemes and revoke on sign-out',async()=>{
 const client=new PGlite();await client.waitReady;await client.exec(migration);
 const auth=createAuth(drizzle(client,{schema}),{production:false,databaseUrl:'pglite://memory',migrationUrl:undefined,secret:'mobile-auth-test-secret-over-thirty-two-characters',authUrl:'http://localhost:3000',origins:['http://localhost:5173'],port:3000},true);
 try{
  const credentials={email:'mobile-flow@example.test',password:'Mobile-test-only!Password2026'};
  await auth.api.createUser({body:{...credentials,name:'Mobile student'}});
  const request=(path:string,body:object,cookie='',scheme='slate://')=>auth.handler(new Request(`http://localhost:3000/api/auth/${path}`,{method:'POST',headers:{'content-type':'application/json','expo-origin':scheme,...(cookie?{cookie}:{})},body:JSON.stringify(body)}));
  const denied=await request('sign-in/email',credentials,'','untrusted-app://');assert.equal(denied.status,403);
  const login=await request('sign-in/email',credentials);assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie);
  const session=await auth.api.getSession({headers:new Headers({cookie}),query:{disableCookieCache:true,disableRefresh:true}});assert.equal(session?.user.email,credentials.email);
  const out=await request('sign-out',{},cookie);assert.equal(out.status,200);
  assert.equal(await auth.api.getSession({headers:new Headers({cookie}),query:{disableCookieCache:true,disableRefresh:true}}),null);
 }finally{await client.close();}
});
