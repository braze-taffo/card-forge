import { streamChat, freeAccessCode } from './openai.js'

export async function labRequest(path, options = {}) {
  const code = freeAccessCode()
  const response = await fetch('/api/lab' + path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(code ? { 'X-Access-Code': code } : {}), ...options.headers },
  })
  if (!response.ok) {
    let data; try { data = await response.json() } catch {}
    const error = new Error(data?.error?.message || data?.error || `酒馆连接失败（${response.status}）`)
    error.session = data?.session
    throw error
  }
  return response.json()
}

export function testChannel(settings, config) {
  if (settings.channelMode === 'custom') {
    if (!settings.customBaseUrl?.trim() || !settings.customApiKey?.trim() || !settings.customModel?.trim()) throw new Error('请先在设置中填写完整的 API 地址、密钥和模型')
    return { mode: 'custom', baseUrl: settings.customBaseUrl.trim(), apiKey: settings.customApiKey.trim(), model: settings.customModel.trim() }
  }
  const model = config.freeModels?.find(x => x.id === settings.freeModel) || config.freeModels?.[0]
  if (!model || !config.freeModelAvailable) throw new Error('当前没有可用模型，请先检查设置')
  return { mode: 'free', model: model.id }
}

// Batch small streamed deltas without reordering or duplicating them in the ST relay.
export async function relayTavernRequest({request,channel,path,signal,generate=streamChat,send=labRequest}) {
  let text='',reasoning='',sequence=0,inFlight=null,failure=null
  const flush=()=>{
    if(inFlight || failure || (!text&&!reasoning))return
    const chunk={id:request.id,sequence:++sequence,text:text.slice(0,16000),reasoning:reasoning.slice(0,16000)}
    text=text.slice(chunk.text.length);reasoning=reasoning.slice(chunk.reasoning.length)
    inFlight=send(path+'/chunk',{method:'POST',signal,body:JSON.stringify(chunk)}).catch(e=>{failure=e}).finally(()=>{inFlight=null})
  }
  const timer=setInterval(flush,180)
  try{
    const result=await generate({channel,messages:request.payload.messages,temperature:request.payload.temperature??.9,maxTokens:Math.min(request.payload.max_tokens||2048,4096),signal,onDelta:delta=>{text+=delta.text||'';reasoning+=delta.reasoning||''}})
    clearInterval(timer)
    while(!failure && (inFlight||text||reasoning)){flush();if(inFlight)await inFlight}
    if(failure)throw failure
    await send(path+'/result',{method:'POST',body:JSON.stringify({id:request.id,text:result.text,finishReason:result.finishReason})})
    return result
  }catch(error){
    clearInterval(timer);if(inFlight)await inFlight
    await send(path+'/result',{method:'POST',body:JSON.stringify({id:request.id,error:error.message})}).catch(()=>{})
    throw error
  }
}
