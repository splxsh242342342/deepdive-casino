/* =====================================================================
   ENGINE: game rules only, no DOM. The page (solo tables) and the server
   (live tables) both run this file, so the rules can't drift apart.
   Cards are 2-character strings ("As" = ace of spades); hands are strings of them.
   ===================================================================== */
const fmt=n=>Math.round(+n||0).toLocaleString('en-US');
const rid=()=>Math.random().toString(36).slice(2,8);
const RC='23456789TJQKA',SC='shdc';
const RN={2:'Two',3:'Three',4:'Four',5:'Five',6:'Six',7:'Seven',8:'Eight',9:'Nine',10:'Ten',11:'Jack',12:'Queen',13:'King',14:'Ace'};
const pl=r=>r===6?'Sixes':RN[r]+'s';
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a}
function newDeck(n){const a=[];for(let k=0;k<n;k++)for(const s of SC)for(const r of RC)a.push(r+s);return shuffle(a).join('')}
function cards(str,pre){const o=[];str=String(str||'');for(let i=0;i+1<str.length;i+=2)o.push({r:RC.indexOf(str[i])+2,s:SC.indexOf(str[i+1]),id:pre+'.'+(i>>1)});return o}

/* ---------- table rules ---------- */
const SB=10,BB=20,BUY=1000,PK_MIN=400,PK_MAX=2000,RAKE=.05,RAKE_CAP=60,PK_TURN=25000;
const DECKS=6,CUT=.25,BJ_MIN=10,BJ_MAX=1000,BJ_TURN=20000,BJ_BET=10000,BJ_INS=10000,PK_GAP=3000,BJ_GAP=2500;
const BOTS=[{n:'Octavia',ag:.3},{n:'Mako',ag:.65},{n:'Lumen',ag:.48},{n:'Pip',ag:.4},{n:'Barnacle',ag:.55}];

/* poker hand evaluation: best 5 of up to 7 cards -> [category, tiebreakers...] */
function ev(cs){
 const cnt=new Array(15).fill(0),bys=[[],[],[],[]];
 for(const c of cs){if(c.r<2)continue;cnt[c.r]++;if(bys[c.s])bys[c.s].push(c.r)}
 const sh=rr=>{const h=new Set(rr);if(h.has(14))h.add(1);for(let t=14;t>=5;t--){let k=0;while(k<5&&h.has(t-k))k++;if(k===5)return t}return 0};
 let fl=bys.find(x=>x.length>=5);
 if(fl){fl=fl.slice().sort((a,b)=>b-a);const s=sh(fl);if(s)return[8,s]}
 const g=[];for(let r=14;r>=2;r--)if(cnt[r])g.push([cnt[r],r]);g.sort((a,b)=>b[0]-a[0]||b[1]-a[1]);
 if(!g.length)return[0];
 const kick=(ex,n)=>{const o=[];for(let r=14;r>=2&&o.length<n;r--)if(cnt[r]&&!ex.includes(r))o.push(r);return o};
 if(g[0][0]===4)return[7,g[0][1],...kick([g[0][1]],1)];
 if(g[0][0]===3&&g[1]&&g[1][0]>=2)return[6,g[0][1],g[1][1]];
 if(fl)return[5,...fl.slice(0,5)];
 const s=sh(cs.filter(c=>c.r>=2).map(c=>c.r));if(s)return[4,s];
 if(g[0][0]===3)return[3,g[0][1],...kick([g[0][1]],2)];
 if(g[0][0]===2&&g[1]&&g[1][0]===2)return[2,g[0][1],g[1][1],...kick([g[0][1],g[1][1]],1)];
 if(g[0][0]===2)return[1,g[0][1],...kick([g[0][1]],3)];
 return[0,...kick([],5)]}
const score=a=>{let v=0;for(let i=0;i<6;i++)v=v*15+(a[i]||0);return v};
function describe(e){const[c,a,b]=e;return[
 RN[a]+' high','Pair of '+pl(a),`Two pair, ${pl(a)} and ${pl(b)}`,'Three '+pl(a),`Straight, ${RN[a]} high`,
 `Flush, ${RN[a]} high`,`${pl(a)} full of ${pl(b)}`,'Four '+pl(a),a===14?'Royal flush':`Straight flush, ${RN[a]} high`][c]||''}
/* Monte Carlo chance of winning against n random hands */
function equity(hole,board,n,it){
 const known=new Set(hole.concat(board).map(c=>c.r*4+c.s)),rest=[];
 for(let s=0;s<4;s++)for(let r=2;r<=14;r++)if(!known.has(r*4+s))rest.push({r,s});
 const need=n*2+5-board.length;let w=0;
 for(let i=0;i<it;i++){
  for(let k=0;k<need;k++){const j=k+(Math.random()*(rest.length-k)|0);const t=rest[k];rest[k]=rest[j];rest[j]=t}
  const b=board.concat(rest.slice(n*2,need)),me=score(ev(hole.concat(b)));let top=0;
  for(let o=0;o<n;o++){const v=score(ev([rest[o*2],rest[o*2+1]].concat(b)));if(v>top)top=v}
  w+=me>top?1:me===top?.5:0}
 return w/it}

/* blackjack values */
function val(cs){let t=0,a=0;for(const c of cs){if(c.r<2)continue;t+=c.r>=11&&c.r<=13?10:c.r===14?11:c.r;if(c.r===14)a++}while(t>21&&a){t-=10;a--}return{t,soft:a>0}}
const cv=c=>val([c]).t;
const hv=s=>val(cards(s,'')).t;
const isBJh=h=>h.cs.length===4&&!h.sp&&hv(h.cs)===21;

/* =====================================================================
   NO-LIMIT TEXAS HOLD'EM (cash game): buy in for 400-2,000, blinds 10/20,
   5% rake capped at 60, taken only from pots that see a flop.
   ===================================================================== */
function pkNew(size,live){return{g:'pk',live:live?1:0,h:'',btn:-1,seats:Array(size).fill(null),bd:'',dk:'',cur:0,mr:BB,to:-1,st:0,ph:'idle',dl:0,at:0,tk:'',ax:0,pot:0,rk:0,wn:[]}}
function pkSeat(c,n,bot,s){return{c,n,bot,s,t:0,b:0,f:1,a:0,ac:0,nr:0,l:'',hc:'',w:0,sh:0,bh:'',in:0,out:0,mt:0,lv:0,gone:0,oh:'',rb:0}}
const inHand=p=>p.in&&!p.f,canAct=p=>p.in&&!p.f&&!p.a;
const needs=S=>p=>canAct(p)&&(!p.ac||p.b<S.cur);
function nxt(S,i,pred){const n=S.seats.length;for(let k=1;k<=n;k++){const j=((i+k)%n+n)%n,p=S.seats[j];if(p&&pred(p,j))return j}return -1}
const potOf=S=>S.seats.reduce((a,p)=>a+(p?p.t:0),0);
const rakeOf=(S,pot)=>S.st>=1?Math.min(RAKE_CAP,Math.floor(pot*RAKE)):0;
function pkEligible(S){return S.seats.filter(p=>p&&!p.out&&!p.lv&&!p.gone&&p.s>=BB)}
function pkPop(S){const c=S.dk.slice(-2);S.dk=S.dk.slice(0,-2);return c}
function pkPost(S,i,a){const p=S.seats[i];a=Math.max(0,Math.min(a,p.s));p.s-=a;p.b+=a;p.t+=a;if(p.s===0)p.a=1;return a}
/* can this player raise right now? (not after an all-in that was smaller than a full raise) */
function pkCanRaise(S,i){const p=S.seats[i];return !!p&&S.ph==='bet'&&S.to===i&&!p.nr&&p.b+p.s>S.cur&&S.cur-p.b<p.s&&S.seats.some(q=>q&&q!==p&&canAct(q))}
function pkStart(S){
 for(const p of S.seats)if(p&&p.bot>=0&&p.s<BB){p.s=BUY;p.rb=1}
 const el=pkEligible(S);if(el.length<2)return false;
 S.h=rid();S.bd='';S.dk=newDeck(1);S.st=0;S.pot=0;S.rk=0;S.wn=[];S.ax=0;S.at=0;
 for(const p of S.seats){if(!p)continue;const reb=p.rb;Object.assign(p,{t:0,b:0,f:0,a:0,ac:0,nr:0,l:reb?'Rebought 1,000':'',hc:'',w:0,sh:0,bh:'',rb:0});p.in=el.includes(p)?1:0;if(!p.in)p.f=1}
 S.btn=nxt(S,S.btn<0?-1:S.btn,p=>p.in);
 for(let k=0;k<2;k++){let j=S.btn;do{j=nxt(S,j,p=>p.in);S.seats[j].hc+=pkPop(S)}while(j!==S.btn)}
 const hu=el.length===2,sb=hu?S.btn:nxt(S,S.btn,p=>p.in),bb=nxt(S,sb,p=>p.in); /* heads-up: the button posts the small blind */
 pkPost(S,sb,SB);S.seats[sb].l='Small blind';pkPost(S,bb,BB);S.seats[bb].l='Big blind';
 S.cur=BB;S.mr=BB;S.to=nxt(S,bb,needs(S));
 pkStep(S);return true}
function pkStep(S){
 const alive=[];S.seats.forEach((p,i)=>{if(p&&inHand(p))alive.push(i)});
 if(alive.length===1)return pkAward(S,alive[0]);
 const can=S.seats.filter(p=>p&&canAct(p));
 const done=!can.length||(can.length===1&&can[0].b>=S.cur)||can.every(p=>p.ac&&p.b===S.cur);
 if(done){S.ph='run';S.to=-1;S.dl=0;S.at=Date.now()+(can.length<=1?1200:650);return}
 if(S.to<0||!needs(S)(S.seats[S.to]||{}))S.to=nxt(S,S.to<0?S.btn:S.to,needs(S));
 S.ph='bet';S.tk=S.h+'.'+(++S.ax);S.dl=S.live?Date.now()+PK_TURN:0}
function pkAct(S,i,k,amt){
 if(S.ph!=='bet'||S.to!==i)return false;
 const p=S.seats[i];if(!p)return false;const toCall=S.cur-p.b;
 if(k==='x'&&toCall>0)k='f';
 if(k==='r'&&!pkCanRaise(S,i))k=toCall>0?'c':'x';
 if(k==='f'){p.f=1;p.l='Fold'}
 else if(k==='x'){p.l='Check'}
 else if(k==='c'){const a=pkPost(S,i,toCall);p.l=p.a?'All in':'Call '+fmt(a)}
 else if(k==='r'){const max=p.b+p.s;let to=Math.floor(+amt||0);to=Math.min(Math.max(to,Math.min(max,S.cur+S.mr)),max);
  const bet0=S.cur===0,inc=to-S.cur;pkPost(S,i,to-p.b);
  if(inc>=S.mr){S.mr=inc;for(const q of S.seats)if(q&&q!==p&&canAct(q)){q.ac=0;q.nr=0}} /* a full raise reopens the betting */
  else for(const q of S.seats)if(q&&q!==p&&canAct(q)&&q.ac)q.nr=1; /* a short all-in: players who already acted may only call or fold */
  S.cur=Math.max(S.cur,p.b);p.l=p.a?'All in':(bet0?'Bet ':'Raise to ')+fmt(p.b)}
 else return false;
 p.ac=1;S.to=nxt(S,i,needs(S));pkStep(S);return true}
function pkNext(S){
 for(const p of S.seats)if(p&&p.in){p.b=0;p.ac=0;p.nr=0;if(canAct(p))p.l=''}
 S.cur=0;S.mr=BB;S.at=0;
 if(S.st>=3)return pkShow(S);
 S.st++;pkPop(S);for(let k=S.st===1?3:1;k;k--)S.bd+=pkPop(S);
 S.to=nxt(S,S.btn,needs(S));pkStep(S)}
function pkAward(S,i){const pot=potOf(S),rk=rakeOf(S,pot),p=S.seats[i];p.s+=pot-rk;p.w=pot-rk;S.pot=pot;S.rk=rk;S.wn=[{i,a:pot-rk,f:1}];pkEnd(S)}
function pkShow(S){
 const alive=[];S.seats.forEach((p,i)=>{if(p&&inHand(p))alive.push(i)});
 const bd=cards(S.bd,'x'),sc={};
 for(const i of alive){const p=S.seats[i],e=ev(cards(p.hc,'x').concat(bd));sc[i]=score(e);p.bh=describe(e);p.sh=1}
 const tots=S.seats.map(p=>p?p.t:0),levels=[...new Set(alive.map(i=>tots[i]))].sort((a,b)=>a-b);
 const pot=tots.reduce((a,b)=>a+b,0);let rk=rakeOf(S,pot),prev=0;const won={},real=new Set();
 for(const L of levels){let amt=0;for(const t of tots)amt+=Math.max(0,Math.min(t,L)-prev);
  const take=Math.min(rk,amt);amt-=take;rk-=take; /* rake comes out of the main pot */
  const el=alive.filter(i=>tots[i]>=L),top=Math.max(...el.map(i=>sc[i])),ws=el.filter(i=>sc[i]===top),sh=Math.floor(amt/ws.length);
  ws.forEach((i,k)=>{won[i]=(won[i]||0)+sh+(k===0?amt-sh*ws.length:0);if(el.length>1)real.add(i)});prev=L}
 let left=0;for(const t of tots)left+=Math.max(0,t-prev);
 const ks=Object.keys(won);if(left&&ks.length)won[ks[ks.length-1]]+=left;
 S.pot=pot;S.rk=rakeOf(S,pot);S.wn=[];
 for(const k of ks){const i=+k,p=S.seats[i];p.s+=won[k];p.w=won[k];if(real.has(i))S.wn.push({i,a:won[k]})}
 pkEnd(S)}
function pkEnd(S){S.ph='end';S.to=-1;S.dl=0;S.at=S.live?Date.now()+PK_GAP:0}
function botMove(S,i,it){
 it=it||240;const p=S.seats[i],b=BOTS[p.bot]||BOTS[0],opp=S.seats.filter(q=>q&&q!==p&&inHand(q)).length;
 const bd=cards(S.bd,'x'),e=equity(cards(p.hc,'x'),bd,Math.max(1,opp),bd.length?it:Math.round(it*.75));
 const toCall=S.cur-p.b,pot=potOf(S),rel=e*(opp+1),r=Math.random(),maxTo=p.b+p.s,canR=pkCanRaise(S,i);
 const size=f=>Math.min(maxTo,S.cur+Math.max(S.mr,Math.round((pot+toCall)*f/10)*10));
 if(toCall<=0){if(canR&&((rel>1.45&&r<.4+b.ag*.5)||r<.04+b.ag*.1))return['r',size(.45+Math.random()*.5)];return['x']}
 const odds=toCall/(pot+toCall);
 if(e<odds*.85&&r>b.ag*.08)return['f'];
 if(canR&&rel>1.75&&r<b.ag+.15)return['r',size(.6+Math.random()*.6)];
 return['c']}

/* =====================================================================
   BLACKJACK: 6-deck shoe reshuffled at the cut card, dealer stands on soft 17,
   dealer checks for blackjack, insurance pays 2 to 1, blackjack pays 3 to 2,
   double on any two cards (also after a split), split up to 4 hands
   (split aces get one card each), late surrender. Table limits 10 to 1,000.
   ===================================================================== */
function bjNew(size,live){return{g:'bj',live:live?1:0,h:rid(),ph:'bet',seats:Array(size).fill(null),dc:'',hide:1,sh:'',shuf:0,to:-1,ha:0,dl:0,at:0,tk:'',ax:0,q:[]}}
function bjSeat(c,n,s){return{c,n,bot:-1,s,bet:0,rd:0,t:0,w:0,hs:[],in:0,ins:-1,lv:0,gone:0,lb:0}}
function bjDraw(S){if(S.sh.length<2)S.sh=newDeck(DECKS);const c=S.sh.slice(-2);S.sh=S.sh.slice(0,-2);return c}
function bjDeal(S){
 const ins=[];S.seats.forEach((p,i)=>{if(p&&p.rd&&p.bet>=BJ_MIN&&p.bet<=BJ_MAX&&p.bet<=p.s&&!p.lv&&!p.gone)ins.push(i)});
 if(!ins.length)return false;
 S.shuf=S.sh.length<DECKS*104*CUT?1:0;if(S.shuf)S.sh=newDeck(DECKS); /* the cut card came out: new shoe */
 S.seats.forEach((p,i)=>{if(!p)return;p.in=ins.includes(i)?1:0;p.hs=p.in?[{cs:'',b:p.bet}]:[];p.t=p.in?p.bet:0;p.w=0;p.ins=-1;if(p.in)p.lb=p.bet});
 S.dc='';S.hide=1;S.q=[...ins,'d',...ins,'d'];S.ph='deal';S.to=-1;S.dl=0;S.at=Date.now()+200;return true}
function bjTick(S){
 const now=Date.now();
 if(S.ph==='deal'){const x=S.q.shift();if(x==='d')S.dc+=bjDraw(S);else{const p=S.seats[x];if(p&&p.hs[0])p.hs[0].cs+=bjDraw(S)}
  if(S.q.length)S.at=now+300;else{S.at=0;bjAfterDeal(S)}}
 else if(S.ph==='dealer'){const live=S.seats.some(p=>p&&p.in&&p.hs.some(h=>!h.su&&hv(h.cs)<=21));
  if(live&&hv(S.dc)<17){S.dc+=bjDraw(S);S.at=now+650}else bjSettle(S)}}
function bjAfterDeal(S){
 if(S.dc[0]==='A'){S.ph='ins';S.to=-1;S.tk=S.h+'.ins';S.dl=S.live?Date.now()+BJ_INS:0;for(const p of S.seats)if(p&&p.in)p.ins=-1;return}
 bjPeek(S)}
/* insurance: half the bet, pays 2 to 1 if the dealer has blackjack */
const insCost=p=>Math.floor(p.hs[0].b/2);
function bjIns(S,i,take){
 const p=S.seats[i];if(S.ph!=='ins'||!p||!p.in||p.ins>=0)return false;
 if(take){const a=insCost(p);if(p.s-p.t<a||a<1)return false;p.t+=a;p.ins=a}else p.ins=0;
 if(S.seats.every(q=>!q||!q.in||q.ins>=0))bjPeek(S);return true}
function bjInsTimeout(S){if(S.ph!=='ins')return;for(const p of S.seats)if(p&&p.in&&p.ins<0)p.ins=0;bjPeek(S)}
function bjPeek(S){
 const dBJ=hv(S.dc)===21;
 for(const p of S.seats)if(p&&p.in)for(const h of p.hs)if(dBJ||isBJh(h))h.dn=1;
 if(dBJ){S.ph='dealer';S.hide=0;S.to=-1;S.dl=0;S.at=Date.now()+700;return}
 bjNextHand(S)}
function bjNextHand(S){
 for(let i=0;i<S.seats.length;i++){const p=S.seats[i];if(!p||!p.in)continue;
  for(let k=0;k<p.hs.length;k++){const h=p.hs[k];if(h.dn)continue;if(hv(h.cs)>=21){h.dn=1;continue}
   S.ph='play';S.to=i;S.ha=k;S.tk=S.h+'.'+(++S.ax);S.dl=S.live?Date.now()+BJ_TURN:0;return}}
 S.ph='dealer';S.hide=0;S.to=-1;S.dl=0;S.at=Date.now()+600}
function bjCan(S,i,k){
 if(k==='i'||k==='n'){const p=S.seats[i];return S.ph==='ins'&&!!p&&p.in&&p.ins<0&&(k==='n'||p.s-p.t>=insCost(p))}
 if(S.ph!=='play'||S.to!==i)return false;const p=S.seats[i],h=p&&p.hs[S.ha];if(!h)return false;
 const free=p.s-p.t,two=h.cs.length===4;
 if(k==='d')return two&&free>=h.b;
 if(k==='p'){const a=cards(h.cs,'x');return two&&cv(a[0])===cv(a[1])&&p.hs.length<4&&free>=h.b}
 if(k==='u')return two&&!h.sp&&p.hs.length===1;
 return k==='h'||k==='s'}
function bjAct(S,i,k){
 if(k==='i'||k==='n')return bjIns(S,i,k==='i');
 if(!bjCan(S,i,k))return false;
 const p=S.seats[i],h=p.hs[S.ha];
 if(k==='h')h.cs+=bjDraw(S);
 else if(k==='s')h.dn=1;
 else if(k==='u'){h.su=1;h.dn=1}
 else if(k==='d'){p.t+=h.b;h.b*=2;h.d=1;h.cs+=bjDraw(S);h.dn=1}
 else if(k==='p'){const ace=h.cs[0]==='A';p.t+=h.b;const c2=h.cs.slice(2);h.cs=h.cs.slice(0,2)+bjDraw(S);h.sp=1;
  const nh={cs:c2+bjDraw(S),b:h.b,sp:1};p.hs.splice(S.ha+1,0,nh);if(ace){h.dn=1;nh.dn=1}}
 if(!h.dn&&hv(h.cs)>=21)h.dn=1;
 if(h.dn)bjNextHand(S);else{S.tk=S.h+'.'+(++S.ax);S.dl=S.live?Date.now()+BJ_TURN:0}
 return true}
function bjSettle(S){
 const d=hv(S.dc),dBJ=S.dc.length===4&&d===21;
 for(const p of S.seats){if(!p||!p.in)continue;let back=0;
  for(const h of p.hs){const v=hv(h.cs);let b=0,r;
   if(h.su){b=h.b/2;r='Surrender'}
   else if(v>21)r='Bust';else if(isBJh(h)&&!dBJ){b=h.b*2.5;r='Blackjack'}else if(dBJ&&!isBJh(h))r='Dealer blackjack';
   else if(dBJ){b=h.b;r='Push'}else if(d>21||v>d){b=h.b*2;r='Win'}else if(v===d){b=h.b;r='Push'}else r='Lose';
   h.r=r;h.net=Math.floor(b)-h.b;back+=Math.floor(b)}
  if(p.ins>0&&dBJ)back+=p.ins*3;
  p.w=back;p.s=p.s-p.t+p.w}
 S.ph='end';S.to=-1;S.dl=0;S.at=S.live?Date.now()+BJ_GAP:0}
function bjNewRound(S){S.h=rid();S.ph='bet';S.dc='';S.hide=1;S.to=-1;S.dl=0;S.at=0;S.q=[];S.shuf=0;
 for(const p of S.seats)if(p){p.hs=[];p.t=0;p.w=0;p.in=0;p.rd=0;p.ins=-1}}
