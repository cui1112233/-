import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, catalogFromSettled, visibleModel, defaultModelLabel, normalizeTask, taskAfterReply, taskURL, createHostClient, sourceContext, selectExistingSkill, replyTargetIsCurrent, readableFailure } from '../frontend/src/user/pages/host-agent/host-chat-core.mjs';

test('original catalog string IDs are preserved, not coerced into trial IDs', () => assert.equal(visibleModel({id:'custom-model-42',displayName:'后台原模型'},'text').id,'custom-model-42'));
test('credential fields never leave catalog projection', () => {
 const m=visibleModel({id:'x',name:'N',credential:'secret',apiKey:'secret',baseUrl:'private', capabilities:{apiKey:'secret'}},'image');
 assert.deepEqual(m,{id:'x',kind:'image',name:'N',enabled:true}); assert.ok(!JSON.stringify(m).includes('secret'));
});
test('malformed models do not create selectable ghost models',()=>assert.equal(visibleModel({name:'ghost'},'text'),null));
test('one model category denied does not erase other categories',()=>{
 const list=catalogFromSettled([{status:'fulfilled',value:{models:[{id:'t'}]}},{status:'rejected',reason:Error('403')},{status:'fulfilled',value:{models:[{id:'v'}]}}]);
 assert.equal(list[0].models.length,1); assert.equal(list[1].models.length,0); assert.ok(list[1].error); assert.equal(list[2].models.length,1);
});
test('public default is only a hint, not a catalog selection',()=>{
 assert.equal(defaultModelLabel({modelCatalog:[{id:'other'}]}),'原后台默认对话模型'); assert.equal(defaultModelLabel({model:'original'}),'原后台默认 · original');
});
test('keeps complete source and punctuation',()=>{
 const src='她说：“不要删剧情。”\r\n  原文空格。'; const p=buildPrompt('先写文案',{content:src}); assert.ok(p.includes(src));
});
test('long source rejected before request, never truncated',()=>assert.throws(()=>buildPrompt('需求',{content:'字'.repeat(5800)}),/没有自动截断或发送/));
test('empty message or unreadable attachment rejected',()=>{
 assert.throws(()=>buildPrompt('  ')); assert.throws(()=>buildPrompt('写文案',{content:''}));
});
test('source is not interpreted as a new command',()=>{
 const p=buildPrompt('只整理文字',{content:'“生成视频并上传”只是台词。'}); assert.match(p,/创作原文开始/); assert.deepEqual(selectExistingSkill('只整理文字',[{name:'前贴流程',id:'s'}]),[]);
});
test('tasks use original content field and omit invalid roles',()=>{
 const task=normalizeTask({task:{id:'old-id',messages:[{role:'user',content:'hi'},{role:'system',content:'internal'},{role:'assistant',content:'ok'}]}}); assert.equal(task.messages.length,2);
});
test('missing complete task is an error, not a fabricated history',()=>assert.throws(()=>normalizeTask({task:{id:'x'}})));
test('task reply returned by backend is authoritative',()=>{
 const r=taskAfterReply({task:{id:'t',messages:[{role:'assistant',content:'saved'}]}},{id:'t',messages:[]}); assert.equal(r.messages[0].content,'saved');
});
test('compatible reply envelope preserves old messages',()=>{
 const r=taskAfterReply({user:{role:'user',content:'u'},assistant:{role:'assistant',content:'a'}},{id:'t',messages:[{role:'user',content:'old'}]}); assert.equal(r.messages.length,3);
});
test('incomplete reply never produces a successful placeholder',()=>assert.throws(()=>taskAfterReply({answer:'maybe'}, {id:'t',messages:[]})));
test('URL changes preserve production query and do not turn shuihuo into agent',()=>{
 const u=taskURL({pathname:'/shuihuo-production',search:'?workspace=production&book=x',hash:'#a'},'id/space'); assert.equal(u,'/shuihuo-production?workspace=production&book=x&task=id%2Fspace#a');
});
test('new chat removes only the task query',()=>assert.equal(taskURL({pathname:'/agent',search:'?task=x&view=y'},''),'/agent?view=y'));
test('API adapter reads only same-origin original endpoints',async()=>{
 const calls=[]; const api=createHostClient(async(path,opts)=>{calls.push([path,opts]);return {models:[]};}); await api.listTasks(); await api.config(); await api.catalog();
 assert.deepEqual(calls.map(x=>x[0]),['/api/agent/tasks','/api/config','/api/models?kind=text','/api/models?kind=image','/api/models?kind=video']);
 assert.ok(calls.every(x=>!x[1]?.method));
});
test('send uses the real original body shape, no bogus selected model or credentials',async()=>{
 let called;const api=createHostClient(async(path,opt)=>{called={path,opt};return {};}); await api.send({taskId:'t',prompt:'原文',context:{page:'原系统'},skillIds:[]});
 assert.equal(called.path,'/api/agent/chat'); assert.deepEqual(JSON.parse(called.opt.body),{taskId:'t',prompt:'原文',context:{page:'原系统'},skillIds:[]});
 assert.ok(!called.opt.body.includes('api_key')); assert.ok(!called.opt.body.includes('textModelId'));
});
test('only exact returned skills can be bound',()=>{
 assert.deepEqual(selectExistingSkill('做前贴',[{name:'前贴流程',id:'real'}]),['real']);
 assert.deepEqual(selectExistingSkill('做前贴',[{name:'未知技能',id:'fake'}]),[]);
 assert.deepEqual(selectExistingSkill('前贴是什么',[{name:'前贴流程',id:'real'}]),[]);
});
test('late reply cannot cross conversation, epoch or login',()=>{
 const s={epoch:2,id:'a',token:'private'}; assert.ok(replyTargetIsCurrent(s,{...s}));
 for(const v of [{epoch:3},{id:'b'},{token:'other'}]) assert.equal(replyTargetIsCurrent(s,{...s,...v}),false);
});
test('context explicitly denies unavailable tools, not a hidden workflow promise',()=>{
 const c=sourceContext('/agent',true); assert.match(c.summary,/没有注册图片生成/); assert.match(c.summary,/原文完整/);
 assert.ok(!('apiKey' in c));
});
test('default configuration errors do not ask ordinary users for keys',()=>{
 const s=readableFailure({message:'API Key is required',status:422}); assert.match(s,/不会让你重新填写供应商密钥/);
});
test('authentication errors distinguish original and trial login',()=>assert.match(readableFailure({status:401}),/不需要试用账号/));
test('failed request is surfaced without an automatic retry',async()=>{
 let calls=0;const api=createHostClient(async()=>{calls++;throw Error('lost');}); await assert.rejects(api.send({taskId:'t',prompt:'x'})); assert.equal(calls,1);
});

test('reply for a different task is rejected rather than merged',()=>assert.throws(()=>taskAfterReply({task:{id:'other',messages:[]}},{id:'current',messages:[]})));

import { resolvedModelLabel } from '../frontend/src/user/pages/host-agent/host-chat-core.mjs';
test('selected model travels in JSON, not a credential or URL', async () => {
  const calls=[];const c=createHostClient(async (...args)=>{calls.push(args);return {};});
  await c.send({taskId:'t',prompt:'创作',context:{},textModelId:'catalog-2'});
  const body=JSON.parse(calls[0][1].body);
  assert.equal(body.textModelId,'catalog-2');assert.equal(body.apiKey,undefined);assert.equal(calls[0][0],'/api/agent/chat');
});
test('capability check uses authenticated same-origin API, no model call', async () => {
 const calls=[];const c=createHostClient(async (...a)=>{calls.push(a);return {version:1,textModelSelection:true};});
 const caps=await c.capabilities();assert.equal(caps.textModelSelection,true);assert.equal(calls[0][0],'/api/agent/capabilities');assert.equal(calls[0][1].method,undefined);
});
test('receipt mismatch cannot be displayed as the selected model',()=>{
 assert.throws(()=>resolvedModelLabel({resolvedModel:{catalogId:'other',modelId:'m',source:'catalog'}},'chosen'));
 assert.throws(()=>resolvedModelLabel({resolvedModel:{catalogId:'',modelId:'m',source:'default'}},'chosen'));
});
test('missing receipt is not invented from the request',()=>{
 assert.equal(resolvedModelLabel({},'chosen'),'');
 assert.equal(resolvedModelLabel({resolvedModel:{catalogId:'chosen',modelId:'m',source:'catalog'}},'chosen'),'本轮实际模型：m');
});
test('a local refusal is not misreported as a paid completion',()=>{
 assert.match(resolvedModelLabel({resolvedModel:null,modelCallSkipped:true},'chosen'),/未调用模型/);
});
