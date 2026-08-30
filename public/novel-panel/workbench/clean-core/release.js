/* V78 Stable Release Authority: final public identity and compatibility retirement registry. */
(function installV78StableRelease(){
  if(globalThis.__V78_STABLE_RELEASE__) return;
  const ns=globalThis.VideoPromptCleanCore=globalThis.VideoPromptCleanCore||{};
  const VERSION="v78.3.0.2",BUILD="v78.3.0.2-scene-event-canonical-timeline-20260818-r1";
  const clone=v=>{try{return JSON.parse(JSON.stringify(v));}catch(_){return v;}};
  function checks(){
    const runtime=globalThis.__V78_CLEAN_RUNTIME__||globalThis.VideoPromptRuntime||{};
    const prod=ns.production?.snapshot?.()||{};
    const charAI=ns.characterAI?.snapshot?.()||{};
    const registry=globalThis.__V78_EXECUTOR_REGISTRY__||{};
    const items=[
      ["runtime_version",runtime.version===VERSION,`runtime=${runtime.version||"?"}`],
      ["runtime_build",runtime.build===BUILD||globalThis.__VIDEO_PROMPT_TOOL_BUILD__?.buildId===BUILD,`build=${runtime.build||globalThis.__VIDEO_PROMPT_TOOL_BUILD__?.buildId||"?"}`],
      ["outline_v78_primary",prod.default_route==="v78_primary",`route=${prod.default_route||"?"}`],
      ["character_ai_v78_primary",charAI.default_route==="v78_primary",`route=${charAI.default_route||"?"}`],
      ["single_ai_request",prod.exactly_one_ai_request===true&&prod.post_send_retry===false,"post_send_retry=false"],
      ["workspace_schema",Number(ns.workspace?.schema_version||0)===40,`schema=${ns.workspace?.schema_version||0}`],
      ["formal_roster_authority",globalThis.__V78_FORMAL_ROSTER_STORE__?.version==="formal_roster_store_v78_2_8",`roster=${globalThis.__V78_FORMAL_ROSTER_STORE__?.version||"?"}`],
      ["stable_registry",registry.owner==="V78ReleaseCore",`owner=${registry.owner||"?"}`],
      ["outline_entry",typeof globalThis.generateOutline==="function","generateOutline=ready"],
      ["regenerate_entry",typeof globalThis.regenerateSceneOutline==="function","regenerateSceneOutline=ready"],
      ["v77_fallback_retained",Boolean(globalThis.__V78_OUTLINE_NATIVE_EXECUTORS__?.compatibility_only),"V77 native host=compatibility_only"],
      ["reference_entities",ns.referenceEntities?.version==="reference_entity_resolver_v78_2_4",`reference=${ns.referenceEntities?.version||"?"}`],
      ["master_prompt",ns.masterPrompt?.version==="master_prompt_service_v78_2",`master=${ns.masterPrompt?.version||"?"}`],
    ];
    return items.map(([id,ok,detail])=>({id,status:ok?"pass":"fail",detail}));
  }
  function snapshot(){const rows=checks();return {version:VERSION,build:BUILD,channel:"stable",released_at:"2026-08-17",status:rows.every(x=>x.status==="pass")?"ready":"degraded",checks:rows,legacy:{default_executor:false,fallback_retained:true,protocol_markers_retained:true,globals_retained_as_aliases:true},workspace_schema:40};}
  const release=Object.freeze({version:VERSION,build:BUILD,channel:"stable",checks,snapshot,deprecatedCompatibility:Object.freeze(["runOutlineV77","runSceneRegenerationV77","__V77_CLEAN_CORE_BRIDGE__","__V77_CURRENT_RUNTIME__","V77_CHARACTER_CORE_* markers"])});
  ns.release=release;globalThis.__V78_STABLE_RELEASE__=release;globalThis.VideoPromptRelease=release;
  globalThis.__V78_CURRENT_RUNTIME__=globalThis.__V78_CURRENT_RUNTIME__||globalThis.__V77_CURRENT_RUNTIME__||Object.freeze({version:VERSION,buildId:BUILD,label:"V78.3.0.2 · 场景锚点/事件归属/连续时间轴根治"});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>console.info("[V78 Stable] release ready",snapshot()),{once:true});else console.info("[V78 Stable] release ready",snapshot());
})();
