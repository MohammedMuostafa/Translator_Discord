import type { DiscordInteraction, DiscordMessage } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import { languageLabel, normalizeLanguage, targetSelectOptions } from './languages.js';
import { getPreference } from './storage/preferences.js';
import { createAiActionSession, getAiActionSession } from './services/aiActionSessions.js';
import { runAiAction, type AiAction } from './services/aiActions.js';
import { translateText } from './providers/translator.js';
import { createSpeechSession } from './services/speechSessions.js';
import { geminiTtsConfigured } from './services/geminiTts.js';
import {
  createSmartReply,
  translateEditedReplyToArabic,
  type SmartReplyMode,
  type SmartReplyResult
} from './services/smartReply.js';
import {
  createSmartReplySession,
  getSmartReplySession,
  updateSmartReplySession
} from './services/smartReplySessions.js';
import { getDisplayRuntimeSettings, type DisplayRuntimeSettings } from './services/runtimeConfig.js';

const RLM='\u200f'; const LRI='\u2066'; const PDI='\u2069';

function userIdOf(interaction: DiscordInteraction): string {
  const id=interaction.member?.user?.id??interaction.user?.id;
  if(!id)throw new Error('Could not resolve the invoking Discord user.');
  return id;
}
function option(interaction: DiscordInteraction,name:string):string|undefined{return interaction.data?.options?.find(i=>i.name===name)?.value as string|undefined}
function targetMessage(interaction:DiscordInteraction):DiscordMessage|undefined{const id=interaction.data?.target_id;return id?interaction.data?.resolved?.messages?.[id]:undefined}
function safeCodeBlock(text:string):string{return text.replaceAll('```','ˋˋˋ')}
function isRtl(code:string):boolean{const n=normalizeLanguage(code,true);return ['ar-eg','ar-msa','fa','he'].includes(n)}

function stabilizeRtl(text:string,language:string):string{
  if(!isRtl(language))return text;
  let inFence=false;
  return text.replace(/\(\s*\(([^()\n]*[A-Za-z][^()\n]*)\)\s*\)/g,'($1)').split('\n').map(line=>{
    if(/^\s*```/.test(line)){inFence=!inFence;return line} if(inFence||!line.trim())return line;
    const m=line.match(/^(\s{0,3}#{1,3}\s+|\s*>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+)?/); const prefix=m?.[0]??''; let body=line.slice(prefix.length);
    body=body.replace(/\(([^()\n]*[A-Za-z][^()\n]*)\)/g,`${LRI}($1)${PDI}`).replace(/\[([^\[\]\n]*[A-Za-z][^\[\]\n]*)\]/g,`${LRI}[$1]${PDI}`).replace(/https?:\/\/[^\s]+/g,`${LRI}$&${PDI}`).replace(/(?:[A-Za-z0-9][A-Za-z0-9._:/@#%+&?=,'\-]*)(?:[ \t]+(?:[A-Za-z0-9][A-Za-z0-9._:/@#%+&?=,'\-]*))*/g,`${LRI}$&${PDI}`).replace(/\s+([،؛؟])/g,'$1');
    return `${prefix}${RLM}${body}`;
  }).join('\n');
}

function listenComponents(userId:string,text:string,language:string):Array<Record<string,unknown>>{
  if(!geminiTtsConfigured()||language==='auto')return[];
  const id=createSpeechSession(userId,text,language);
  return [{type:1,components:[{type:2,style:2,label:'🔊 Listen / استمع',custom_id:`listen_tts:${id}`}]}];
}

function actionLabel(action:AiAction,display?:DisplayRuntimeSettings):string{
  const raw=(()=>{switch(action){case'summarize':return'📝 Summary';case'explain':return'🧠 Explain';case'simplify':return'💡 Simplify';case'rewrite':return'✍️ Rewrite';case'reply':return'💬 Draft Reply';default:return'🤖 TD AI'}})();
  return display?.showEmojis===false?raw.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u,''):raw;
}
function arabicReplyLanguage(preferred:string):string{return normalizeLanguage(preferred,true)==='ar-msa'?'ar-msa':'ar-eg'}
function quote(text:string,language:string):string{return stabilizeRtl(text,language).split('\n').map(line=>`> ${line}`).join('\n')}
function heading(display:DisplayRuntimeSettings,offset=0):string{const base=display.headingSize==='large'?1:display.headingSize==='small'?3:2;return '#'.repeat(Math.min(3,base+offset))}
function icon(display:DisplayRuntimeSettings,value:string):string{return display.showEmojis?value:''}
function blockGap(display:DisplayRuntimeSettings):string{return display.density==='compact'?'\n':display.density==='relaxed'?'\n\n\n':'\n\n'}
function divider(display:DisplayRuntimeSettings):string{return display.divider==='line'?'\n---\n':display.divider==='spaced'?'\n\n':' '}
function arabicBlock(text:string,language:string,display:DisplayRuntimeSettings):string{return display.quoteArabic?quote(text,language):stabilizeRtl(text,language)}

function smartReplyContent(result:SmartReplyResult,arabicLanguage:string,display:DisplayRuntimeSettings):string{
  const messageLabel=result.isQuestion?'السؤال بالعربي':'الرسالة بالعربي';
  const h1=heading(display,0);const h2=heading(display,1);const gap=blockGap(display);const sep=divider(display);
  const title=`${h1} ${icon(display,result.isQuestion?'❓ ':'💬 ')}Smart Answer`;
  const detected=display.showDetectedLanguage?`**Detected:** ${result.sourceLanguage}`:'';
  const arabicSource=[`${h2} ${icon(display,'🇸🇦 ')}${messageLabel}`,arabicBlock(result.translatedMessage,arabicLanguage,display)].join('\n');
  const reply=[`${h2} ${icon(display,'💬 ')}Reply — ${result.sourceLanguage}`,stabilizeRtl(result.answer,result.sourceLanguageCode)].join('\n');
  const arabicReply=[`${h2} ${icon(display,'📝 ')}معنى الرد بالعربي`,arabicBlock(result.answerArabic,arabicLanguage,display)].join('\n');
  const ordered=display.smartAnswerArabicFirst?[arabicSource,reply,arabicReply]:[reply,arabicSource,arabicReply];
  return [title,detected,...ordered].filter(Boolean).join(gap+sep).replace(/\n{4,}/g,'\n\n\n');
}
function smartReplyComponents(userId:string,sessionId:string,result:SmartReplyResult,arabicLanguage:string):Array<Record<string,unknown>>{
  return [
    {type:1,components:[
      {type:2,style:1,label:'🔄 Change',custom_id:`smart_reply:regen:${sessionId}`},
      {type:2,style:2,label:'✂️ Shorter',custom_id:`smart_reply:shorter:${sessionId}`},
      {type:2,style:2,label:'🧠 More Detail',custom_id:`smart_reply:detailed:${sessionId}`},
      {type:2,style:2,label:'✏️ Edit Answer',custom_id:`smart_reply:edit:${sessionId}`},
      {type:2,style:3,label:'✅ Use Reply',custom_id:`smart_reply:use:${sessionId}`}
    ]},
    ...listenComponents(userId,result.answerArabic,arabicLanguage)
  ];
}

async function runAndEdit(interaction:DiscordInteraction,fn:()=>Promise<Record<string,unknown>>):Promise<void>{
  try{await editOriginalResponse(interaction.application_id,interaction.token,await fn())}
  catch(error){const message=error instanceof Error?error.message:'Unexpected AI error.';console.error(error);await editOriginalResponse(interaction.application_id,interaction.token,{content:clipDiscord(`❌ ${message}`),components:[],allowed_mentions:{parse:[]}}).catch(console.error)}
}

export async function handleAiMessagePicker(interaction:DiscordInteraction):Promise<Record<string,unknown>>{
  const userId=userIdOf(interaction);const message=targetMessage(interaction);if(!message?.content?.trim())throw new Error('This message has no text for TD AI to process.');
  const prefs=await getPreference(userId);const sessionId=createAiActionSession(userId,message);
  return {content:['## 🤖 TD AI',`**My language:** ${languageLabel(prefs.incoming)}`,'','Choose an action:'].join('\n'),components:[{type:1,components:[{type:2,style:1,label:'🌐 Translate',custom_id:`ai_action:translate:${sessionId}`},{type:2,style:3,label:'❓ Answer',custom_id:`ai_action:answer:${sessionId}`},{type:2,style:2,label:'📝 Summarize',custom_id:`ai_action:summarize:${sessionId}`}]},{type:1,components:[{type:2,style:2,label:'🧠 Explain',custom_id:`ai_action:explain:${sessionId}`},{type:2,style:2,label:'💡 Simplify',custom_id:`ai_action:simplify:${sessionId}`},{type:2,style:2,label:'✍️ Rewrite',custom_id:`ai_action:rewrite:${sessionId}`},{type:2,style:2,label:'💬 Draft Reply',custom_id:`ai_action:reply:${sessionId}`}]}],allowed_mentions:{parse:[]}};
}

export function handleAiActionButton(interaction:DiscordInteraction):void{
  void runAndEdit(interaction,async()=>{
    const [,actionRaw,sessionId]=(interaction.data?.custom_id??'').split(':');const session=sessionId?getAiActionSession(sessionId):undefined;if(!session)throw new Error('This TD AI menu expired. Open TD AI on the message again.');
    const userId=userIdOf(interaction);if(session.userId!==userId)throw new Error('This TD AI menu belongs to another user.');const prefs=await getPreference(userId);
    if(actionRaw==='translate')return{content:'## 🌐 Translate\nChoose the target language:',components:[{type:1,components:[{type:3,custom_id:`ai_translate_target:${sessionId}`,placeholder:`Translate to… (My language: ${languageLabel(prefs.incoming)})`.slice(0,150),min_values:1,max_values:1,options:targetSelectOptions(prefs.incoming)}]}],allowed_mentions:{parse:[]}};
    if(actionRaw==='answer'){
      const language=arabicReplyLanguage(prefs.incoming);const result=await createSmartReply(session.message.content,language);const smartId=createSmartReplySession(userId,session.message.content,language,result);const display=await getDisplayRuntimeSettings();
      return{content:clipDiscord(smartReplyContent(result,language,display),1900),components:smartReplyComponents(userId,smartId,result,language),allowed_mentions:{parse:[]}};
    }
    const action=actionRaw as AiAction;if(!['summarize','explain','simplify','rewrite','reply'].includes(action))throw new Error('Unknown TD AI action.');
    const output=await runAiAction(action,session.message.content,prefs.incoming);const display=await getDisplayRuntimeSettings();return{content:clipDiscord(`${heading(display)} ${actionLabel(action,display)}${blockGap(display)}${stabilizeRtl(output,prefs.incoming)}`,1900),components:listenComponents(userId,output,prefs.incoming),allowed_mentions:{parse:[]}};
  });
}

export function handleSmartReplyEditModal(interaction:DiscordInteraction):Record<string,unknown>{
  const [,action,sessionId]=(interaction.data?.custom_id??'').split(':');
  if(action!=='edit'||!sessionId)throw new Error('Invalid edit request.');
  const session=getSmartReplySession(sessionId);if(!session)throw new Error('This answer expired. Open TD AI on the message again.');
  if(session.userId!==userIdOf(interaction))throw new Error('This answer belongs to another user.');
  return {
    custom_id:`smart_reply_edit:${sessionId}`,
    title:'Edit Answer',
    components:[{type:1,components:[{type:4,custom_id:'answer',style:2,label:`Reply — ${session.result.sourceLanguage}`.slice(0,45),value:session.result.answer.slice(0,4000),placeholder:'Edit the reply before using it…',required:true,max_length:4000}]}]
  };
}

function modalValue(interaction:DiscordInteraction,customId:string):string|undefined{
  for(const row of interaction.data?.components??[]){for(const component of row.components??[]){if(component.custom_id===customId)return component.value}}
  return undefined;
}

export function handleSmartReplyEditSubmit(interaction:DiscordInteraction):void{
  void runAndEdit(interaction,async()=>{
    const customId=interaction.data?.custom_id??'';const sessionId=customId.startsWith('smart_reply_edit:')?customId.slice('smart_reply_edit:'.length):'';const session=sessionId?getSmartReplySession(sessionId):undefined;
    if(!session)throw new Error('This answer expired. Open TD AI on the message again.');const userId=userIdOf(interaction);if(session.userId!==userId)throw new Error('This answer belongs to another user.');
    const edited=modalValue(interaction,'answer')?.trim();if(!edited)throw new Error('Edited answer cannot be empty.');
    const answerArabic=await translateEditedReplyToArabic(edited,session.language);const result={...session.result,answer:edited,answerArabic};updateSmartReplySession(sessionId,result);const display=await getDisplayRuntimeSettings();
    return{content:clipDiscord(smartReplyContent(result,session.language,display),1900),components:smartReplyComponents(userId,sessionId,result,session.language),allowed_mentions:{parse:[]}};
  });
}

export function handleSmartReplyButton(interaction:DiscordInteraction):void{
  void runAndEdit(interaction,async()=>{
    const [,action,sessionId]=(interaction.data?.custom_id??'').split(':');const session=sessionId?getSmartReplySession(sessionId):undefined;if(!sessionId||!session)throw new Error('This answer expired. Open TD AI on the message again.');
    const userId=userIdOf(interaction);if(session.userId!==userId)throw new Error('This answer belongs to another user.');
    if(action==='use')return{content:['## ✅ Ready to send',`**Reply language:** ${session.result.sourceLanguage}`,'','```text',safeCodeBlock(session.result.answer),'```','','**Arabic meaning**',quote(session.result.answerArabic,session.language),'','Copy the reply, paste it into Discord, then press Enter.'].join('\n'),components:listenComponents(userId,session.result.answerArabic,session.language),allowed_mentions:{parse:[]}};
    const modeMap:Record<string,SmartReplyMode>={regen:'alternative',shorter:'shorter',detailed:'detailed'};const mode=modeMap[action??''];if(!mode)throw new Error('Unknown answer action.');
    const result=await createSmartReply(session.sourceMessage,session.language,mode,session.result.answer);updateSmartReplySession(sessionId,result);const display=await getDisplayRuntimeSettings();
    return{content:clipDiscord(smartReplyContent(result,session.language,display),1900),components:smartReplyComponents(userId,sessionId,result,session.language),allowed_mentions:{parse:[]}};
  });
}

export function handleAiTranslateTarget(interaction:DiscordInteraction):void{
  void runAndEdit(interaction,async()=>{
    const customId=interaction.data?.custom_id??'';const sessionId=customId.startsWith('ai_translate_target:')?customId.slice('ai_translate_target:'.length):'';const session=sessionId?getAiActionSession(sessionId):undefined;if(!session)throw new Error('This TD AI menu expired. Open it again from the message.');
    const userId=userIdOf(interaction);if(session.userId!==userId)throw new Error('This TD AI menu belongs to another user.');const prefs=await getPreference(userId);const selected=interaction.data?.values?.[0];const target=normalizeLanguage(selected==='my'||!selected?prefs.incoming:selected);
    const translated=await translateText(session.message.content,target,{source:'auto',provider:prefs.provider,style:prefs.style});const display=await getDisplayRuntimeSettings();const source=display.showDetectedLanguage&&translated.detectedSourceLanguage?` • from ${languageLabel(translated.detectedSourceLanguage)}`:'';const provider=display.showProvider&&translated.provider?` • ${translated.provider}`:'';
    return{content:clipDiscord(`${heading(display)} ${icon(display,'🌐 ')}Translation\n**To:** ${languageLabel(target)}${source}${provider}${blockGap(display)}${stabilizeRtl(translated.text,target)}`,1900),components:listenComponents(userId,translated.text,target),allowed_mentions:{parse:[]}};
  });
}

export function handleAiSlash(interaction:DiscordInteraction):void{
  void runAndEdit(interaction,async()=>{
    const userId=userIdOf(interaction);const prefs=await getPreference(userId);const action=(option(interaction,'action')??'ask') as AiAction;const text=option(interaction,'text')?.trim();if(!text)throw new Error('Text is required.');const requested=option(interaction,'language')??'my';const language=requested==='my'?prefs.incoming:normalizeLanguage(requested,true);const result=await runAiAction(action,text,language);const display=await getDisplayRuntimeSettings();
    return{content:clipDiscord(`${heading(display)} ${actionLabel(action,display)}${blockGap(display)}${stabilizeRtl(result,language)}`,1900),components:listenComponents(userId,result,language),allowed_mentions:{parse:[]}};
  });
}

export function handleHelp():Record<string,unknown>{return{content:['## ✨ TD AI — Quick Help','','**Right-click any message → Apps → TD AI**','🌐 Translate • ❓ Smart Answer • 📝 Summarize • 🧠 Explain • 💡 Simplify • ✍️ Rewrite • 💬 Draft Reply','','**Smart Answer controls**','🔄 Change • ✂️ Shorter • 🧠 More Detail • ✏️ Edit Answer • ✅ Use Reply','','**Commands**','`/chat open` private AI chat • `/voicechat join` live voice • `/translate` translation • `/ai` AI tools • `/settings` preferences • `/status` system status'].join('\n'),allowed_mentions:{parse:[]}}}
