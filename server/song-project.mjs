import {createHash} from 'node:crypto';
import {ServiceError} from './generation-service.mjs';

export const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const recipes={
  original:{name:'保留当前声音',gains:{piano:0,guitar:0,bass:0,drums:0,strings:0,vocal:0},room:.26},
  intimate:{name:'收拢伴奏，让讲述靠近',gains:{piano:-.8,guitar:-.4,bass:-1,drums:-3,strings:-2,vocal:.3},room:.18},
  lift:{name:'展开现有伴奏，托起副歌',gains:{piano:.4,guitar:.5,bass:.8,drums:1.5,strings:2,vocal:0},room:.28},
  release:{name:'轻推伴奏，留出尾音空间',gains:{piano:0,guitar:0,bass:.5,drums:.8,strings:1.5,vocal:0},room:.32}
};
const intent={
  intro:['熟悉、安静','用一个熟悉的动机把听众带回校园。','暂不进入歌词，让记忆先有声音。','木吉他铺底，钢琴预示副歌动机。','无人声，给第一句留出入口。'],
  verse1:['亲近、带一点害羞','看见共享耳机和故意走慢的放学路。','用试卷、刘海、耳机呈现关系，避免直接说“青春”。','中低音区、短动机，伴奏给叙事留白。','像向老朋友讲往事，注意“舍不得摘”的语气和呼吸。'],
  pre1:['期待、尚未说出口','当时以为还有很多时间。','把具体画面引向“夏天很长”的误解。','旋律抬升，鼓与弦乐逐步承接。','句子连贯，向副歌积累气息，避免突然喊唱。'],
  chorus1:['怀念、温暖展开','让“那条放学后的路”成为共同记忆。','重复核心意象，让听众记住一句话。','保留副歌动机与句尾长音，现有鼓和贝斯更清楚。','清楚唱出标题，长音有支撑，保留现在的人声。'],
  interlude:['短暂停留','从过去转向现在。','无人声，为叙事转场留白。','钢琴承接句尾，减少密度。','无人声，保留呼吸空间。'],
  verse2:['距离、成年后的体谅','号码停用、同学录泛黄，彼此已各自忙碌。','让加班和晚风体现关心，避免苦情堆砌。','沿用主歌动机，轻鼓维持向前感。','比第一段平实，检查长句咬字是否匆忙。'],
  pre2:['明白、些许遗憾','明白当年的时间其实很短。','“很长”与“来不及”形成前后照应。','保留相同旋律，让歌词变化承担意义。','句尾收住，为第二次副歌留出余地。'],
  chorus2:['更深的怀念','同一句副歌，带着成年后的理解。','保持核心歌词，让情境改变听感。','保持副歌旋律，检查与上一段的强弱差。','加强重点词表达，而非每个字都用力。'],
  bridge:['克制、短暂脆弱','回到旧操场，向过去说一句话。','把个人怀念寄托在放学铃声上。','伴奏回落，给最后副歌制造空间。','柔和而清楚，尾字不要过早断开。'],
  final:['释怀、祝愿','从想留住你，转成祝你有自己的自由。','落在“想唱就唱的自由”，完成主题转折。','沿用熟悉动机，伴奏支撑最后一次展开。','有力量但不紧绷，最后一句逐步放松。'],
  outro:['余温、继续向前','让祝愿留在歌结束之后。','无人声，留给听众自己的回忆。','钢琴回到开头动机，自然结束。','保留尾音，避免突然截断。']
};
export const goalFields=['audience','message','feeling','style','scenes','keep','avoid','acceptance'];
export const sectionFields=['emotion','story','lyrics','music','performance'];
// Authored planning suggestions, never measurements of the audio or quality scores.
const expressionSuggestions={intro:[1,1,'开头是否让人愿意靠近这个故事？'],verse1:[2,2,'是否像在讲一段真实的放学记忆，而不是念词？'],pre1:[3,4,'能否听出期待在累积，同时还没有完全展开？'],chorus1:[4,3,'标题句是否记得住，怀念里是否仍有温暖？'],interlude:[2,2,'这次留白能否自然带我们从校园回到现在？'],verse2:[2,3,'成年后的距离感是否出现，而不是重复第一段的语气？'],pre2:[3,4,'同一条旋律，是否唱出了“来不及”的遗憾？'],chorus2:[4,4,'相同的副歌，是否比第一次多了一层回望？'],bridge:[1,4,'伴奏回落后，那句留言是否反而更牵动人？'],final:[4,2,'最后是否从挽留变成祝愿，有力量却不紧绷？'],outro:[1,1,'结束之后是否留下温暖的余韵？']};
export function initialExpression(id){const [energy,tension,listenFor]=expressionSuggestions[id]||[2,2,'这一段是否传达了预期的感受？'];return {energy,tension,listenFor};}
export function initialBrief(score){return {
  goal:{audience:'90 后，以及经历过校园友情、暗恋与成长的人。',message:'把没说完的青春，变成长大后给彼此的祝愿。',feeling:'先亲近，再怀念，最后带着温暖与释怀离开。',style:'有经典华语流行气质的新原创；旋律易记，表达克制，不复刻具体老歌。',scenes:'2000 年代至 2010 年代初的校园；试卷、共享耳机、同学录；与成年后的加班和晚风对照。',keep:'歌曲主题、标题动机、末副歌的祝愿；本轮保留原歌词、旋律和人声录音。',avoid:'年代符号堆砌、过度煽情、伴奏盖住歌词、所有段落一样用力。',acceptance:'能记住一句副歌；听清歌词；听出主歌、副歌和结尾的变化；最后感到温暖。需真实试听判断。'},
  sections:score.sections.map(s=>{const a=intent[s.id]||['待明确',s.intention,s.lyrics.join(' / ')||'器乐段落',s.intention,'待试听'];return {id:s.id,...Object.fromEntries(sectionFields.map((key,i)=>[key,a[i]])),treatment:'original',expression:initialExpression(s.id)};})
};}
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))throw new ServiceError('创作依据的字段不完整或不受支持。');}
function words(value,max=600){if(typeof value!=='string'||!value.trim()||value.length>max)throw new ServiceError(`请填写 1–${max} 字的创作要求。`);return value.trim();}
export function validateBrief(input,score){
  exact(input,['goal','sections']);exact(input.goal,goalFields);
  const goal=Object.fromEntries(goalFields.map(k=>[k,words(input.goal[k])]));
  if(!Array.isArray(input.sections)||input.sections.length!==score.sections.length)throw new ServiceError('请保留完整歌曲结构。');
  const sections=score.sections.map((s,i)=>{const p=input.sections[i];exact(p,['id',...sectionFields,'treatment',...(Object.hasOwn(p||{},'expression')?['expression']:[])]);if(p.id!==s.id||!Object.hasOwn(recipes,p.treatment))throw new ServiceError('段落或制作方式无效。');const expression=p.expression===undefined?initialExpression(s.id):p.expression;exact(expression,['energy','tension','listenFor']);if(![expression.energy,expression.tension].every(n=>Number.isInteger(n)&&n>=1&&n<=5))throw new ServiceError('音乐力度与情绪张力需在 1–5 之间。');return {id:s.id,...Object.fromEntries(sectionFields.map(k=>[k,words(p[k],400)])),treatment:p.treatment,expression:{energy:expression.energy,tension:expression.tension,listenFor:words(expression.listenFor,200)}};});
  return {goal,sections};
}
export function compilePlan(brief,score){return {
  engine:'existing-stems-mix-v1',base:'original',
  changes:brief.sections.filter(p=>p.treatment!=='original').map(p=>{const s=score.sections.find(s=>s.id===p.id);return {...structuredClone(recipes[p.treatment]),id:p.id,name:s.name,treatmentName:recipes[p.treatment].name,start:s.start,end:s.end,emotion:p.emotion};}),
  preserved:['原歌词与旋律','原人声录音与咬字','未选中段落的音频（逐采样保留）'],
  pending:['故事与歌词是否准确表达目标，需试听与人工判断。','旋律、节奏、和声、乐器声部的新创作尚未由本页执行。','演唱语气、换气和咬字要求已记录；本次不会重新合成演唱。'],
  transitionMs:120,
  assessment:{state:'unreviewed',message:'渲染成功仅代表制作完成，艺术目标仍需试听验收。'}
};}
