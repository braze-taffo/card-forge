// This bridge runs inside the real ST frontend. No provider key is stored here.
const context = () => SillyTavern.getContext();
const events = [];
let generating=false, readyMs;
const record = (name) => { events.push({ name, at: Date.now() }); if(name==='GENERATION_STARTED')generating=true;if(name==='GENERATION_ENDED')generating=false;if (events.length > 40) events.shift(); };
const safe = (value) => { try { return JSON.parse(JSON.stringify(value)); } catch { return null; } };
const start = () => {
    const c = context();
    for (const name of ['GENERATION_STARTED', 'GENERATION_ENDED', 'MESSAGE_RECEIVED', 'MESSAGE_RENDERED', 'CHAT_CHANGED']) {
        if (c.eventTypes[name]) c.eventSource.on(c.eventTypes[name], () => record(name));
    }
    window.__forgeLab = {
        inspect() {
            const c = context();
            const variables = {};
            if (window.TavernHelper) {
                for (const type of ['chat', 'character', 'global']) {
                    try { variables[type] = safe(TavernHelper.getVariables({ type })); } catch (e) { variables[type] = { error: e.message }; }
                }
                variables.messages = c.chat.slice(-8).map((_, i) => {
                    const id = Math.max(0, c.chat.length - 8) + i;
                    try { return { id, value: safe(TavernHelper.getVariables({ type: 'message', message_id: id })) }; }
                    catch (e) { return { id, error: e.message }; }
                });
            }
            return {
                character: c.characters[c.characterId]?.name, characterId: c.characterId,
                chatId: c.chatId, onlineStatus: c.onlineStatus,
                worldbook: c.characters[c.characterId]?.data?.extensions?.world || '',
                regexEnabled: !!c.extensionSettings.character_allowed_regex?.includes(c.characters[c.characterId]?.avatar),
                messages: c.chat.slice(-20).map((m, i) => ({ id: Math.max(0, c.chat.length - 20) + i, name: m.name, isUser: m.is_user, text: String(m.mes || '').slice(0, 14000), extra: safe(m.extra) })),
                variables, events: [...events], helperReady: !!window.TavernHelper,
                mvuReady: !!window.Mvu,
                operation:{status:generating?'running':'idle'},
                loadTiming:{readyMs:readyMs??null,slowResources:performance.getEntriesByType('resource').filter(r=>r.duration>500).sort((a,b)=>b.duration-a.duration).slice(0,8).map(r=>({path:new URL(r.name).pathname,durationMs:Math.round(r.duration),bytes:r.transferSize}))},
            };
        },
        async select(avatar) {
            await c.getCharacters();
            const index = c.characters.findIndex(x => x.avatar === avatar);
            if (index < 0) throw new Error('导入的角色卡未找到');
            c.powerUserSettings.world_import_dialog = false;
            await c.selectCharacterById(index);
        },
        async importBook(book, name) {
            const worldInfo = await import('/scripts/world-info.js');
            await worldInfo.saveWorldInfo(name, worldInfo.convertCharacterBook(book), true);
            await worldInfo.updateWorldInfoList();
        },
        stop() { context().stopGeneration(); },
    };
    if(window.__forgeEmbedConfig)startNative(window.__forgeEmbedConfig);
};
const c = context();
const progress = phase => { if(window.__forgeEmbedConfig?.parentOrigin==='https://tellev.click') window.parent.postMessage({type:'forge:progress',phase},'https://tellev.click'); };
progress('加载扩展与变量框架');
c.eventSource.once(c.eventTypes.APP_READY, start);

async function startNative(config){
    const parentOrigin=config.parentOrigin;
    if(parentOrigin!=='https://tellev.click')return;
    const storageKey='forge-current-chat:'+config.sessionId;
    const remember=()=>{const c=context();try{sessionStorage.setItem(storageKey,JSON.stringify({avatar:c.characters[c.characterId]?.avatar,chatId:c.chatId}))}catch{}};
    const emit=()=>{try{remember();window.parent.postMessage({type:'forge:observation',observation:{...window.__forgeLab.inspect(),viewport:{width:innerWidth,height:innerHeight},source:'native-browser'}},parentOrigin)}catch(error){window.parent.postMessage({type:'forge:error',message:error.message},parentOrigin)}};
    const until=Date.now()+20000;while(!window.TavernHelper&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
    try{
        let selected=config;
        try{const cached=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(cached?.avatar===config.avatar)selected=cached}catch{}
        progress('打开当前角色');
        const c=context();
        if(config.bookName){
            const worldInfo=await import('/scripts/world-info.js');
            if(!worldInfo.world_names?.includes(config.bookName)){
                const card=c.characters.find(character=>character.avatar===selected.avatar);
                if(card?.data?.character_book)await window.__forgeLab.importBook(card.data.character_book,config.bookName);
            }
        }
        if(c.characters[c.characterId]?.avatar!==selected.avatar)await window.__forgeLab.select(selected.avatar);
        if(selected.chatId && context().chatId!==selected.chatId)await context().openCharacterChat(selected.chatId);
        progress('连接预览模型');
        document.querySelector('#api_button_openai')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        readyMs=Math.round(performance.now());
        window.parent.postMessage({type:'forge:ready'},parentOrigin);
        emit();setInterval(emit,1800);
        addEventListener('message',async event=>{
            if(event.origin!==parentOrigin||event.source!==window.parent)return;
            if(event.data?.type==='forge:refresh'){remember();await context().saveChat();location.reload()}
            if(event.data?.type==='forge:stop')window.__forgeLab.stop();
        });
    }catch(error){window.parent.postMessage({type:'forge:error',message:'酒馆加载失败：'+error.message},parentOrigin)}
}
