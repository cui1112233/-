import test from 'node:test';
import assert from 'node:assert/strict';
import { h3PromptEditRequest } from './h3PromptEditing.js';

test('editing final H3 prompt preserves exact bytes and previous manual segments', () => {
 const trace = {director_revision_id:'d1',timeline:{timeline:{audio_asset_id:'a1'}},compilation:{id:'c1',compilation:{video_preset:{key:'preset'},segments:[
 {segment_key:'SEG001',editable_copy_revision:1,compiled_prompt:'自动',compile_trace:{switches:{base_setup:true}}},
 {segment_key:'SEG002',editable_copy_revision:3,compiled_prompt:'另一段人工内容',compile_trace:{editable_copy_source:'user_final_prompt'}}
 ]}}};
 const request = h3PromptEditRequest(trace,0,'  精确内容\n');
 assert.equal(request.final_prompt_overrides.SEG001.text,'  精确内容\n');
 assert.equal(request.final_prompt_overrides.SEG002.text,'另一段人工内容');
 assert.equal(request.expected_compilation_id,'c1');
 assert.equal(request.audio_asset_id,'a1');
 assert.throws(() => h3PromptEditRequest(trace,8,'文本'));
 assert.throws(() => h3PromptEditRequest(trace,0,'  '));
});
