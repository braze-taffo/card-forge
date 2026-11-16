<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { state, saveTavernReport } from '../store.js'
import { exportCardJson } from '../lib/models.js'
import { labRequest, testChannel, relayTavernRequest } from '../lib/tavern-test.js'
import { downloadJson } from '../lib/download.js'
import AppIcon from './AppIcon.vue'

const opened=ref(false),lease=ref(null),busy=ref(false),error=ref(''),observations=ref({})
const nativeFrame=ref(null),embedUrl=ref(''),embedOrigin=ref(''),nativeReady=ref(false),nativeFailed=ref(false)
const enableMvu=ref(true),persona=ref('玩家'),selectedModel=ref(''),stage=ref('')
const nativeStage=ref('正在加载酒馆界面')
const root=ref(null),restoreFocus=ref(null)
const previousReports=computed(()=>state.current?.tavernReports||[])
const statusLabel=computed(()=>({queued:`正在排队 · 前方 ${Math.max(0,(lease.value?.queuePosition||1)-1)} 场`,starting:'正在准备完整酒馆',ready:nativeReady.value?'酒馆已就绪':nativeStage.value,failed:'环境启动失败',expired:'环境已回收',closed:'预览已结束'})[lease.value?.status]||'准备预览')
const loadTimeout='酒馆网页加载超时，请重新打开网页；当前会话仍保留'
let draftId,channel,timer,nativeTimer,controller,polling=false,lastCheckpointAt=0,lastCheckpoint='',lastObservationSent=0,pollingError=''
const providerCalls=new Map()
const base=()=>`/sessions/${lease.value.id}`
const displayError=e=>{error.value=e?.message||String(e)}
async function openLab(){
  restoreFocus.value=document.activeElement;opened.value=true;error.value='';draftId=state.current.id;lease.value=null;observations.value={}
  await nextTick();root.value?.focus()
  try{
    await labRequest('/health')
    const cached=sessionStorage.getItem(`cardforge.lab.${draftId}`);if(!cached)return
    const previous=previousReports.value.find(x=>x.leaseId===cached)
    channel=previous?.channelMode==='free'?testChannel({channelMode:'free',freeModel:previous.model},state.serverConfig):testChannel(state.settings,state.serverConfig)
    const current=await labRequest(`/sessions/${cached}`)
    if(['queued','starting','ready'].includes(current.status)){lease.value=current;observations.value=previous?.manual||{};startPolling()}
    else sessionStorage.removeItem(`cardforge.lab.${draftId}`)
  }catch(e){displayError(e)}
}
async function create(){
  busy.value=true;error.value=''
  try{
    observations.value={};embedUrl.value='';nativeReady.value=false;nativeStage.value='正在加载酒馆界面';lastCheckpointAt=0;lastCheckpoint=''
    channel=selectedModel.value?testChannel({channelMode:'free',freeModel:selectedModel.value},state.serverConfig):testChannel(state.settings,state.serverConfig)
    lease.value=await labRequest('/sessions',{method:'POST',body:JSON.stringify({card:exportCardJson(state.current),persona:persona.value,enableMvu:enableMvu.value,mobile:innerWidth<=860})})
    sessionStorage.setItem(`cardforge.lab.${draftId}`,lease.value.id);startPolling()
  }catch(e){if(e.session){lease.value=e.session;sessionStorage.setItem(`cardforge.lab.${draftId}`,e.session.id);startPolling()}displayError(e)}finally{busy.value=false}
}
function startPolling(){clearInterval(timer);controller?.abort();controller=new AbortController();timer=setInterval(poll,1800);poll()}
async function pumpModels(){
  const result=await labRequest(base()+'/requests')
  for(const request of result.requests||[]){
    if(request.actor!=='manual'||providerCalls.has(request.id))continue
    const requestPath=base(),parentController=controller,requestChannel={...channel},callController=new AbortController()
    providerCalls.set(request.id,callController)
    const onAbort=()=>callController.abort();parentController.signal.addEventListener('abort',onAbort,{once:true})
    ;(async()=>{
      try{stage.value='模型正在回复';await relayTavernRequest({request,channel:requestChannel,path:requestPath,signal:callController.signal})}
      catch(e){if(!callController.signal.aborted)displayError(e)}
      finally{providerCalls.delete(request.id);parentController.signal.removeEventListener('abort',onAbort);if(!providerCalls.size)stage.value=''}
    })()
  }
}
function watchNativeLoading(){clearTimeout(nativeTimer);nativeTimer=setTimeout(()=>{if(opened.value&&!nativeReady.value){nativeFailed.value=true;displayError(new Error(loadTimeout))}},90000)}
async function attachNative(){
  if(embedUrl.value)return
  const view=await labRequest(base()+'/embed');embedOrigin.value=view.origin;embedUrl.value=view.url;nativeReady.value=false;nativeFailed.value=false;watchNativeLoading()
}
function onNativeMessage(event){
  if(!opened.value||!lease.value||event.origin!==embedOrigin.value||event.source!==nativeFrame.value?.contentWindow)return
  if(event.data?.type==='forge:progress' && ['加载酒馆界面','加载扩展与变量框架','打开当前角色','连接预览模型'].includes(event.data.phase)){nativeStage.value=event.data.phase;watchNativeLoading();return}
  if(event.data?.type==='forge:ready'){clearTimeout(nativeTimer);nativeReady.value=true;nativeFailed.value=false;if(error.value===loadTimeout)error.value='';return}
  if(event.data?.type==='forge:error'){clearTimeout(nativeTimer);nativeFailed.value=true;displayError(new Error(event.data.message));return}
  if(event.data?.type!=='forge:observation'||!event.data.observation)return
  observations.value={...event.data.observation,observedAt:Date.now()}
  if(Date.now()-lastObservationSent>3000){lastObservationSent=Date.now();labRequest(base()+'/observation',{method:'POST',body:JSON.stringify({observation:observations.value})}).catch(()=>{})}
}
window.addEventListener('message',onNativeMessage)
async function refreshNative(){
  error.value='';nativeFailed.value=false
  if(nativeReady.value){nativeReady.value=false;nativeFrame.value?.contentWindow?.postMessage({type:'forge:refresh'},embedOrigin.value);watchNativeLoading()}
  else{embedUrl.value='';await nextTick();await attachNative().catch(displayError)}
}
async function poll(){
  if(polling||!opened.value||!lease.value)return
  polling=true
  try{
    lease.value=await labRequest(base())
    if(lease.value.status==='ready'){await pumpModels();await attachNative();if(!nativeReady.value)observations.value=await labRequest(base()+'/state');await checkpoint()}
    else if(['failed','closed','expired'].includes(lease.value.status)){clearInterval(timer);clearTimeout(nativeTimer);controller?.abort();if(lease.value.error)error.value=lease.value.error;sessionStorage.removeItem(`cardforge.lab.${draftId}`)}
    if(pollingError&&error.value===pollingError)error.value='';pollingError=''
  }catch(e){pollingError=e.message;displayError(e)}finally{polling=false}
}
function record(incomplete=false){return {at:Date.now(),leaseId:lease.value.id,revision:lease.value.revision,profile:lease.value.profile,model:channel?.model,channelMode:channel?.mode,report:incomplete?'预览已中断，保留最后一次读取到的记录。':'玩家预览记录',manual:observations.value,incomplete}}
async function checkpoint(){
  if(Date.now()-lastCheckpointAt<10000)return
  const current=JSON.stringify(observations.value);if(current===lastCheckpoint)return
  await saveTavernReport(draftId,record());lastCheckpoint=current;lastCheckpointAt=Date.now()
}
async function persistRecord(){
  let incomplete=false
  try{const snapshot=await labRequest(base()+'/state');if(!nativeReady.value)observations.value=snapshot}catch{incomplete=true}
  const result=record(incomplete);await saveTavernReport(draftId,result);return result
}
async function downloadRecord(){try{const result=lease.value?.status==='ready'?await persistRecord():previousReports.value.at(-1);if(result)downloadJson(result,'酒馆预览记录')}catch(e){displayError(e)}}
async function finish(){
  busy.value=true
  try{if(lease.value?.status==='ready')await persistRecord();controller?.abort();if(lease.value)lease.value=await labRequest(base(),{method:'DELETE'});sessionStorage.removeItem(`cardforge.lab.${draftId}`);closeLocal()}catch(e){displayError(e)}finally{busy.value=false}
}
function closeLocal(){clearInterval(timer);clearTimeout(nativeTimer);controller?.abort();opened.value=false;embedUrl.value='';nativeReady.value=false;stage.value='';restoreFocus.value?.focus()}
async function closeWindow(){if(busy.value)return;if(lease.value?.status==='ready')await persistRecord().catch(displayError);closeLocal()}
function trapFocus(event){
  if(event.key==='Escape'){event.preventDefault();closeWindow();return}
  if(event.key!=='Tab')return
  const elements=[...root.value.querySelectorAll('button:not(:disabled),input,select,summary,iframe,[tabindex="0"]')].filter(e=>e.offsetParent!==null)
  if(event.shiftKey&&document.activeElement===elements[0]){elements.at(-1)?.focus();event.preventDefault()}
  else if(!event.shiftKey&&document.activeElement===elements.at(-1)){elements[0]?.focus();event.preventDefault()}
}
onBeforeUnmount(()=>{window.removeEventListener('message',onNativeMessage);closeLocal()})
</script>

<template>
  <button v-if="state.serverConfig.labAvailable && state.current?.kind === 'Character'" class="lab-entry" :disabled="state.busy" @click="openLab"><AppIcon name="tavern" /><span>酒馆预览</span><AppIcon name="arrow" class="lab-entry-arrow" /></button>
  <Teleport to="body"><div v-if="opened" class="lab-backdrop">
    <section ref="root" class="lab-dialog" role="dialog" aria-modal="true" aria-labelledby="lab-title" tabindex="-1" @keydown="trapFocus">
      <header class="lab-header"><div><h2 id="lab-title">把这张卡放进酒馆</h2><p class="muted">{{ statusLabel }}<template v-if="lease?.status === 'ready'"> · {{ channel?.model }}</template></p></div><button class="link" :disabled="busy" aria-label="收起预览窗口" @click="closeWindow"><AppIcon name="close" /></button></header>
      <p v-if="error" class="banner error" role="alert">{{ error }}</p>
      <div v-if="!lease || ['failed','expired','closed'].includes(lease.status)" class="lab-intro">
        <p>在真实酒馆里试聊当前角色，亲自体验世界书、变量和状态栏。这里使用草稿的独立副本。</p>
        <label class="field"><span>玩家名称</span><input v-model="persona" maxlength="80" /></label>
        <label class="field"><span>预览模型</span><select v-model="selectedModel"><option value="">沿用当前模型设置</option><option v-for="model in state.serverConfig.freeModels" :key="model.id" :value="model.id">{{ model.name }} · 站内免费</option></select></label>
        <label class="lab-check"><input v-model="enableMvu" type="checkbox" />加载固定版本的 MVU 变量框架</label>
        <p class="muted">包含 TavernHelper 与提示词模板扩展。可同时开放四场预览；每场最多保留 45 分钟，离开后约 5 分钟回收。请保持窗口打开以接收模型回复。</p>
        <button class="primary" :disabled="busy || !state.current?.card?.name?.trim()" @click="create">{{ busy ? '正在申请…' : '创建临时酒馆' }}</button>
        <p v-if="!state.current?.card?.name?.trim()" class="muted">先给角色起个名字，再进入酒馆。</p>
        <details v-if="previousReports.length"><summary>已保存的预览记录（{{ previousReports.length }}）</summary><article v-for="item in [...previousReports].reverse()" :key="item.at"><p class="muted">{{ new Date(item.at).toLocaleString() }}</p><pre>{{ item.report }}</pre><button @click="downloadJson(item, '酒馆预览记录')">下载记录</button></article></details>
      </div>
      <div v-else-if="lease.status !== 'ready'" class="lab-preparing" aria-busy="true">
        <div class="lab-spinner" aria-hidden="true"><i v-for="dot in 5" :key="dot" :style="{ '--dot': dot - 1 }" /></div>
        <p class="lab-preparing-title" role="status" aria-live="polite">{{ statusLabel }}</p>
        <p class="muted">{{ lease.status === 'queued' ? '有空位时，就轮到你的故事。' : '为故事布置好舞台，需要一点时间。' }}<br />这一步不会调用模型。</p>
        <button :disabled="busy" @click="finish">取消预览</button>
      </div>
      <template v-else>
        <div class="lab-toolbar"><span class="muted" role="status">{{ stage || '亲自试聊，看看故事如何展开' }}</span><button :disabled="busy" @click="refreshNative">刷新酒馆</button><button :disabled="busy" @click="downloadRecord">保存记录</button><button :disabled="busy" @click="finish">结束预览</button></div>
        <div class="lab-content">
          <iframe v-if="embedUrl" ref="nativeFrame" :src="embedUrl" class="lab-native-frame" title="当前角色的临时酒馆预览" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads" referrerpolicy="no-referrer" />
          <div v-if="!nativeReady" class="lab-native-loading" aria-busy="true"><div class="lab-spinner" aria-hidden="true"><i v-for="dot in 5" :key="dot" :style="{ '--dot': dot - 1 }" /></div><p role="status">{{ nativeFailed ? '酒馆网页还未就绪' : nativeStage }}</p><button v-if="nativeFailed" @click="refreshNative">重新打开网页</button></div>
        </div>
      </template>
    </section>
  </div></Teleport>
</template>

<style scoped>
.lab-entry{display:inline-flex;align-items:center;gap:8px;min-height:42px;padding:9px 14px;color:var(--accent-text);background:var(--accent-soft,#e6efe9);border:1px solid var(--accent,#9bb5a5);border-radius:12px 10px 13px 11px;font-weight:600;white-space:nowrap}.lab-entry .app-icon{width:21px;height:21px}.lab-entry .lab-entry-arrow{width:17px;height:17px}.lab-entry:hover{filter:brightness(.97)}.lab-entry:focus-visible{outline:2px solid var(--accent-text);outline-offset:3px}
.lab-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(37,48,44,.3);backdrop-filter:blur(5px);padding:18px;display:flex;align-items:center;justify-content:center}
.lab-dialog{width:min(1540px,100%);height:min(950px,96vh);display:flex;flex-direction:column;overflow:auto;background:var(--bg,#faf9f5);border:1px solid var(--border);border-radius:20px 16px 22px 17px;box-shadow:0 18px 70px #263b3024;outline:none}
.lab-header{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--border)}.lab-header h2{margin:0;font-size:21px}.lab-header p{margin:5px 0 0}
.lab-intro{max-width:680px;padding:25px;margin:auto;display:flex;flex-direction:column;gap:16px}.lab-intro p{margin:0;line-height:1.8}.lab-check{display:flex;gap:10px;align-items:center}.lab-check input{width:auto}
.lab-preparing{margin:auto;text-align:center;padding:40px 24px;animation:lab-wait-appear .45s ease-out}.lab-preparing-title{margin:24px 0 10px;font-size:19px;color:var(--accent-text)}.lab-preparing .muted{line-height:1.9;font-size:14px}.lab-preparing button{margin-top:20px}
.lab-spinner{position:relative;width:54px;height:54px;margin:auto;color:var(--accent-text)}.lab-spinner i{position:absolute;inset:0;animation:lab-dot-orbit 2.8s cubic-bezier(.4,0,.25,1) infinite;animation-delay:calc(var(--dot) * -.16s)}.lab-spinner i::before{content:'';position:absolute;top:2px;left:calc(50% - 2.5px);width:5px;height:5px;border-radius:50%;background:currentColor}
@keyframes lab-dot-orbit{0%{transform:rotate(-45deg);opacity:0}8%{opacity:1}45%{transform:rotate(180deg)}78%{opacity:1}100%{transform:rotate(675deg);opacity:0}}
@keyframes lab-wait-appear{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.lab-preparing{animation:none}.lab-spinner i{animation:none;transform:rotate(calc(var(--dot) * 72deg));opacity:.7}}
.lab-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 18px}.lab-toolbar .muted{flex:1;min-width:160px}.lab-content{position:relative;display:flex;flex:1;min-height:0;overflow:hidden;margin:0 18px 18px}.lab-native-frame{display:block;width:100%;height:100%;flex:1;border:1px solid var(--border);border-radius:10px;background:#272727}
.lab-native-loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:24px}.lab-native-loading .lab-spinner{margin:0}.lab-dialog .banner{margin:10px 18px}.lab-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:13px;line-height:1.8}.lab-dialog details{padding:10px;border:1px solid var(--border);border-radius:10px}.lab-dialog summary{cursor:pointer}.lab-dialog article+article{border-top:1px solid var(--border);margin-top:12px;padding-top:12px}
@media(max-width:860px){.lab-backdrop{padding:0}.lab-dialog{height:100dvh;max-height:none;border-radius:0}.lab-header{padding:12px}.lab-header h2{font-size:18px}.lab-toolbar{padding:10px;gap:6px}.lab-toolbar .muted{flex-basis:100%}.lab-toolbar button{font-size:13px;padding:8px 10px}.lab-content{margin:0 10px 10px}.lab-intro{padding:20px}}
@media(max-width:860px){.lab-entry{min-height:46px;font-size:15px;gap:10px;padding:10px 16px}.lab-entry .app-icon{width:24px;height:24px}}
</style>
