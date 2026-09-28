import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { measureH3VideoLines } from './h3LineAudio.js';

test('H3 sends each frozen source line once and never uses browser duration', async () => {
 const calls=[];
 const result=await measureH3VideoLines({directorId:'d', document:{video_source_hash:'h',video_source_revision:'r',director_cards:[{source_key:'a',source_text:'甲'},{source_key:'b',source_text:'乙'}]},tts:{voice:'v'}, synthesize:async input=>{calls.push(input);return input.input;}, encode:async x=>x, measure:async body=>body});
 assert.deepEqual(calls,[{voice:'v',input:'甲'},{voice:'v',input:'乙'}]);
 assert.deepEqual(result.lines,[{source_key:'a',source_text:'甲',audio_base64:'甲'},{source_key:'b',source_text:'乙',audio_base64:'乙'}]);
 assert.equal(result.director_revision_id,'d');
 assert.equal('duration_ms' in result,false);
 assert.match(result.tts_fingerprint,/^[a-f0-9]{64}$/);
});

test('H3 reuses measured audio only for identical source and TTS config', async () => {
 const document={video_source_hash:'h',video_source_revision:'r',director_cards:[{source_key:'a',source_text:'甲',source_text_hash:'text'}]};
 const tts={voice:'v'};
 let count=0;
 const options={directorId:'d',document,tts,synthesize:async()=>{count++;return 'bytes';},encode:async x=>x,measure:async body=>({audio_asset_id:'a',audio_measurement:{measurement:{method:'per_line_tts_probe',asset_id:'a',video_source_hash:'h',video_source_revision:'r',tts_fingerprint:body.tts_fingerprint,lines:[{source_key:'a',source_text_hash:'text',duration_ms:3240}]}}})};
 const first=await measureH3VideoLines(options);
 const again=await measureH3VideoLines({...options,previous:first.audio_measurement.measurement});
 assert.equal(count,1);
 assert.equal(again.audio_asset_id,'a');
 await measureH3VideoLines({...options,tts:{voice:'changed'},previous:first.audio_measurement.measurement});
 assert.equal(count,2);
});

test('H3 fingerprints TTS settings when insecure HTTP has no crypto.subtle', async () => {
 const cryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}});
 try {
  const tts={voice:'zh-CN-XiaoxiaoNeural',style:'general',speed:1.8,pitch:10};
  const serialized=JSON.stringify(Object.keys(tts).sort().map(key=>[key,tts[key]]));
  const expected=createHash('sha256').update(serialized).digest('hex');
  const result=await measureH3VideoLines({
   directorId:'d',
   document:{video_source_hash:'h',video_source_revision:'r',director_cards:[{source_key:'a',source_text:'甲'}]},
   tts,
   synthesize:async()=>new Uint8Array([1]),
   encode:async()=> 'AQ==',
   measure:async body=>body,
  });
  assert.equal(result.tts_fingerprint,expected);
 } finally {
  if (cryptoDescriptor) Object.defineProperty(globalThis,'crypto',cryptoDescriptor);
  else delete globalThis.crypto;
 }
});
