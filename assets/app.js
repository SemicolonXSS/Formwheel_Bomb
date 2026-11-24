import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getDatabase, ref, get, set, onValue, runTransaction, remove, onDisconnect, update
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-database.js";

import {getAuth,signInAnonymously} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBreTSe1m0-xlbF4aupnU5isRZCihR25IE",
  authDomain: "formwheel.firebaseapp.com",
  databaseURL: "https://formwheel-default-rtdb.firebaseio.com",
  projectId: "formwheel",
  storageBucket: "formwheel.firebasestorage.app",
  messagingSenderId: "431583088241",
  appId: "1:431583088241:web:74e0e34ea1e3e1170c55d0",
  measurementId: "G-T372YXDF8D"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app), auth = getAuth(app);
const ROOT = "bombRooms/v2/";

const MIN_MS = 10000, MAX_MS = 30000, FLOOR_MS = 5000, STEP_MS = 1000, MAX_PLAYERS = 10;

/* ---------- 저장소 (탭마다 다른 플레이어 ID: 한 기기에서 테스트 가능) ---------- */
const store = {
  get(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ sessionStorage.setItem(k,v); }catch(e){} },
  del(k){ try{ sessionStorage.removeItem(k); }catch(e){} },
  lget(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  lset(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
};
let myId = "";
async function authenticate(){
 await auth.authStateReady();
 myId=(auth.currentUser||(await signInAnonymously(auth)).user).uid;
}

let roomId = "";
let lastState = null;
let unsubscribe = null;
let lastSeq = null;       // 마지막으로 처리한 이벤트 번호
let exploding = false;
let passing = false;
let offset = 0;           // 서버 시간 보정값 (기기 시계 차이 제거)
let toastTimer = null;

const $ = id => document.getElementById(id);
const now = () => Date.now() + offset;

onValue(ref(db, ".info/serverTimeOffset"), s => { offset = Number(s.val()) || 0; });

/* ---------- 유틸 ---------- */
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

// 10~30초 사이 랜덤 (0.1초 단위)
function randomDuration(){
  return MIN_MS + Math.floor(Math.random() * ((MAX_MS - MIN_MS) / 100 + 1)) * 100;
}

function makeRoomCode(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for(let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

// 입장 순서로 고정 정렬 → 모든 기기에서 같은 순서
function sortedPlayers(obj){
  return Object.values(obj || {}).sort((a,b) =>
    (a.joinedAt || 0) - (b.joinedAt || 0) || String(a.id).localeCompare(String(b.id)));
}

function toast(msg, ms = 2000){
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function buzz(p){ try{ navigator.vibrate && navigator.vibrate(p); }catch(e){} }

function getName(){
  const n = $("name").value.trim().slice(0,20);
  if(!n){
    alert("닉네임을 입력해주세요.");
    $("name").focus();
    return null;
  }
  store.set("bombName", n);
  store.lset("bombName", n);
  return n;
}

/* ---------- 방 만들기 / 참가 ---------- */
async function createRoom(){
  const name = getName();
  if(!name) return;
  $("createBtn").disabled = true;

  try{
    await authenticate();
    let created="";
    for(let i=0;i<8;i++){
      const code=makeRoomCode(),time=now();
      const tx=await runTransaction(ref(db,ROOT+code),cur=>cur===null?{
        status:"waiting",hostId:myId,
        players:{[myId]:{id:myId,name,alive:true,joinedAt:time}},
        presence:{[myId]:true},startedAt:0,duration:0,round:0,createdAt:time
      }:undefined,{applyLocally:false});
      if(tx.committed){created=code;break;}
    }
    if(!created)throw Error("방 코드를 만들지 못했습니다.");
    roomId=created;

    enterGame();
    listenRoom();
  }catch(e){
    console.error(e);
    alert("방 만들기에 실패했습니다.\nFirebase Realtime Database 규칙과 설정을 확인해주세요.");
  }finally{
    $("createBtn").disabled = false;
  }
}

async function joinRoom(codeArg){
  const name = codeArg ? (store.get("bombName") || "플레이어") : getName();
  if(!name) return;

  const code = (codeArg || $("roomInput").value).trim().toUpperCase();
  if(!code){
    alert("방 코드를 입력해주세요.");
    return;
  }

  $("joinBtn").disabled = true;
  try{
    await authenticate();
    if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))throw Error("6자리 방 코드를 입력해 주세요.");
    const target=ref(db,ROOT+code),current=(await get(target)).val();
    if(!current){if(codeArg)store.del("bombRoom");else alert("방을 찾을 수 없습니다.");return;}
    if(!current.players?.[myId]){
      if(current.status!=="waiting"||Object.keys(current.players||{}).length>=MAX_PLAYERS)throw Error("이미 시작했거나 방이 가득 찼습니다.");
      await update(target,{["players/"+myId]:{id:myId,name,alive:true,joinedAt:now()},["presence/"+myId]:true});
    }

    roomId = code;
    enterGame();
    listenRoom();
  }catch(e){
    console.error(e);
    alert("방 참가에 실패했습니다.\nFirebase Realtime Database 규칙과 설정을 확인해주세요.");
  }finally{
    $("joinBtn").disabled = false;
  }
}

function enterGame(){
  store.set("bombRoom", roomId);
  $("lobby").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("roomCode").textContent = roomId;
  window.scrollTo(0, 0);
}

async function armPresence(code){
  if(!code||!myId)return;
  const target=ref(db,ROOT+code+"/presence/"+myId);
  await onDisconnect(target).set(false);
  if(roomId===code)await set(target,true);
}
onValue(ref(db,".info/connected"),snap=>{
  if(snap.val()&&roomId)armPresence(roomId).catch(console.warn);
});
function listenRoom(){
  if(unsubscribe)unsubscribe();
  lastSeq=null;
  const code=roomId;
  armPresence(code).catch(()=>toast("연결 종료 감지 설정 실패"));
  unsubscribe=onValue(ref(db,ROOT+code),snap=>{
    const data=snap.val();
    if(!data?.players?.[myId]){
      store.del("bombRoom");
      alert("방이 종료되었거나 참가 상태가 해제됐어요.");
      location.reload();return;
    }
    if(data.presence?.[data.hostId]===false){
      const first=sortedPlayers(data.players).find(p=>data.presence?.[p.id]===true);
      if(first?.id===myId)set(ref(db,ROOT+code+"/hostId"),myId).catch(console.warn);
    }
    if(data.hostId===myId&&data.passRequest)settlePass(code,data.passRequest).catch(console.warn);
    lastState = { ...data, list: sortedPlayers(data.players) };
    render();
  }, error => {
    console.error(error);
    alert("게임 데이터를 불러오지 못했습니다.");
  });
}

/* ---------- 나가기 ---------- */
async function leaveRoom(){
  const code = roomId;
  try{
    if(code){
      const target=ref(db,ROOT+code),current=(await get(target)).val();
      if(current?.hostId===myId&&current.status==="waiting"){
        await runTransaction(target,cur=>{
          if(!cur||cur.hostId!==myId||cur.status!=="waiting")return;
          delete cur.players[myId];delete cur.presence?.[myId];
          const rest=sortedPlayers(cur.players);
          if(!rest.length)return null;
          cur.hostId=rest.find(p=>cur.presence?.[p.id]===true)?.id||rest[0].id;
          return cur;
        },{applyLocally:false});
      }else if(current?.players?.[myId]){
        const changes={["presence/"+myId]:false};
        if(current.status==="waiting")Object.assign(changes,{["presence/"+myId]:null,["players/"+myId]:null});
        await update(target,changes);
      }
      await onDisconnect(ref(db,ROOT+code+"/presence/"+myId)).cancel().catch(()=>{});
    }
  }catch(e){toast("퇴장 실패: "+e.message);return;}
  store.del("bombRoom");
  unsubscribe?.();

  location.reload();
}

/* ---------- 게임 시작 ---------- */
async function startGame(){
  if(!roomId) return;
  let err = null;

  try{
    await runTransaction(ref(db, ROOT + roomId), cur => {
      err = null;
      if(!cur) return cur;
      if(cur.hostId !== myId){ err = "host"; return; }
      if(cur.status !== "waiting"){ return; }

      const alive = sortedPlayers(cur.players).filter(p => p.alive&&cur.presence?.[p.id]===true);
      if(alive.length < 2){ err = "min"; return; }

      const first = alive[Math.floor(Math.random() * alive.length)];
      const seq = ((cur.event && cur.event.seq) || 0) + 1;

      cur.status = "playing";
      cur.round = (cur.round || 0) + 1;
      cur.duration = randomDuration();
      cur.startedAt = now();
      cur.bombHolder = first.id;
      cur.winner = null;
      cur.winnerId = null;
      cur.event = { seq, type: "start", to: first.id };
      return cur;
    });

    if(err === "host") alert("호스트만 게임을 시작할 수 있습니다.");
    if(err === "min") alert("최소 2명이 참가해야 게임을 시작할 수 있습니다.");
  }catch(e){
    console.error(e);
    alert("게임 시작에 실패했습니다.\nFirebase Realtime Database 규칙을 확인해주세요.");
  }
}

/* ---------- 폭탄 넘기기 ---------- */
async function passBomb(){
 if(!roomId||passing||lastState?.bombHolder!==myId)return;
 passing=true;
 try{
  await set(ref(db,ROOT+roomId+"/passRequest"),{uid:myId,seq:lastState.event.seq});
 }catch(e){toast("폭탄 전달 실패: "+e.message);}
 finally{passing=false;render();}
}
async function settlePass(code,request){
 await runTransaction(ref(db,ROOT+code),cur=>{
  if(!cur||cur.hostId!==myId||cur.passRequest?.seq!==request.seq||cur.passRequest?.uid!==request.uid)return;
  const next={...cur,passRequest:null};
  if(cur.status!=="playing"||cur.bombHolder!==request.uid||cur.event?.seq!==request.seq||now()>=cur.startedAt+cur.duration)return next;
  const alive=sortedPlayers(cur.players).filter(p=>p.alive&&(p.id===request.uid||cur.presence?.[p.id]!==false));
  if(alive.length<2)return next;
  const index=alive.findIndex(p=>p.id===request.uid),to=alive[(index+1)%alive.length].id;
  return {...next,bombHolder:to,event:{seq:request.seq+1,type:"pass",from:request.uid,to}};
 },{applyLocally:false});
}

/* ---------- 폭발 / 탈락 ---------- */
async function explode(){
  if(!roomId) return;

  try{
    await runTransaction(ref(db, ROOT + roomId), cur => {
      if(!cur || cur.hostId!==myId || cur.status !== "playing") return;
      // 서버 기준으로 실제로 시간이 지났을 때만 폭발 (중복 폭발 방지)
      if(now() < cur.startedAt + cur.duration) return;

      const holder = cur.bombHolder;
      const players = cur.players || {};
      if(!players[holder]) return;

      const deadCount = Object.values(players).filter(p => !p.alive).length;
      players[holder].alive = false;
      players[holder].outOrder = deadCount + 1;

      const alive = sortedPlayers(players).filter(p => p.alive);
      const seq = ((cur.event && cur.event.seq) || 0) + 1;
      const victim = { id: holder, name: players[holder].name };

      if(alive.length <= 1){
        cur.status = "finished";
        cur.winner = alive.length === 1 ? alive[0].name : null;
        cur.winnerId = alive.length === 1 ? alive[0].id : null;
        cur.bombHolder = null;
        cur.startedAt = 0;
        cur.event = { seq, type: "explode", from: victim.id, name: victim.name, to: null, final: true };
      }else{
        const next = alive[Math.floor(Math.random() * alive.length)];
        cur.bombHolder = next.id;
        cur.startedAt = now();
        cur.duration = randomDuration();          // 새 폭탄은 다시 10~30초
        cur.event = { seq, type: "explode", from: victim.id, name: victim.name, to: next.id, final: false };
      }

      cur.players = players;
      return cur;
    });
  }catch(e){
    console.error(e);
  }
}

/* ---------- 다시 하기 ---------- */
async function restartGame(){
  if(!roomId) return;
  try{
    await runTransaction(ref(db, ROOT + roomId), cur => {
      if(!cur) return cur;
      if(cur.hostId !== myId) return;
      if(cur.status !== "finished") return;

      const players = cur.players || {};
      Object.keys(players).forEach(k => {
        players[k].alive = true;
        delete players[k].outOrder;
      });

      const seq = ((cur.event && cur.event.seq) || 0) + 1;
      cur.players = players;
      cur.status = "waiting";
      cur.bombHolder = null;
      cur.startedAt = 0;
      cur.duration = 0;
      cur.winner = null;
      cur.winnerId = null;
      cur.event = { seq, type: "reset" };
      return cur;
    });
  }catch(e){
    console.error(e);
    alert("다시 시작에 실패했습니다.");
  }
}

/* ---------- 화면 그리기 ---------- */
function render(){
  const s = lastState;
  if(!s) return;

  const list = s.list;
  const me = list.find(p => p.id === myId);
  const iAmAlive = !!(me && me.alive);
  const isHost = s.hostId === myId;
  const mine = s.status === "playing" && s.bombHolder === myId && iAmAlive;
  const holder = list.find(p => p.id === s.bombHolder);

  // 플레이어 목록
  $("players").innerHTML = list.map(p => `
    <li data-id="${escapeHtml(p.id)}" class="${p.id === s.bombHolder ? "holder" : ""} ${!p.alive ? "dead" : ""}">
      <span class="bi">💣</span>
      <span class="nm">${escapeHtml(p.name)}</span>
      ${p.id === myId ? '<span class="tag">나</span>' : ""}
      ${p.id === s.hostId ? '<span class="tag">👑</span>' : ""}
      ${!p.alive ? '<span class="tag">💀 탈락</span>' : ""}
    </li>`).join("");

  const bomb = $("bomb");
  const status = $("status");
  status.classList.toggle("mine", mine);
  bomb.classList.toggle("mine", mine);

  $("passBtn").disabled = !mine || passing;
  $("passBtn").classList.toggle("hidden", s.status === "waiting");

  if(s.status === "waiting"){
    bomb.className = "bomb idle";
    $("resultOverlay").classList.add("hidden");
    $("startBtn").classList.toggle("hidden", !isHost);
    $("startBtn").disabled = list.length < 2;

    status.textContent = isHost
      ? (list.length < 2 ? "친구를 기다리는 중..." : "준비 완료! 게임을 시작하세요.")
      : "호스트가 게임을 시작하기를 기다리는 중...";
  }

  if(s.status === "playing"){
    $("startBtn").classList.add("hidden");
    $("resultOverlay").classList.add("hidden");
    if(!bomb.classList.contains("boom")){
      const keep = ["tense","critical"].filter(c => bomb.classList.contains(c));
      bomb.className = "bomb " + (keep.length ? keep.join(" ") : "idle") + (mine ? " mine" : "");
    }

    if(mine) status.textContent = "🔥 내 차례다! 폭탄을 넘겨!";
    else if(!iAmAlive) status.textContent = `💀 관전 중 · ${holder ? holder.name : ""} 님이 폭탄을 가지고 있어요`;
    else status.textContent = holder ? `💣 ${holder.name} 님이 폭탄을 가지고 있어요` : "";
  }

  if(s.status === "finished"){
    $("startBtn").classList.add("hidden");
    bomb.className = "bomb off";
    status.textContent = s.winner ? `🏆 ${s.winner} 승리!` : "게임 종료";
    showResult(s, isHost);
  }

  handleEvent(s);
}

function showResult(s, isHost){
  const dead = s.list.filter(p => !p.alive).sort((a,b) => (b.outOrder||0) - (a.outOrder||0));
  const winner = s.list.find(p => p.id === s.winnerId);
  const ranking = (winner ? [winner] : []).concat(dead);

  const iWon = s.winnerId === myId;
  $("resultTitle").textContent = s.winner ? (iWon ? "🎉 내가 이겼다!" : `${s.winner} 승리!`) : "게임 종료";
  $("resultSub").textContent = iWon ? "끝까지 살아남았어요" : "다음 판에서 복수해 보세요";

  const medals = ["🥇","🥈","🥉"];
  $("rank").innerHTML = ranking.map((p, i) => `
    <li><span class="n">${medals[i] || (i + 1)}</span>
    <span class="nm">${escapeHtml(p.name)}${p.id === myId ? " (나)" : ""}</span></li>`).join("");

  $("restartBtn").classList.toggle("hidden", !isHost);
  $("restartWait").classList.toggle("hidden", isHost);
  $("resultOverlay").classList.remove("hidden");
}

/* ---------- 이벤트(애니메이션) 처리: 이벤트 번호당 한 번만 ---------- */
function handleEvent(s){
  const ev = s.event;
  if(!ev){ if(lastSeq === null) lastSeq = 0; return; }

  // 처음 접속했을 때는 과거 이벤트를 재생하지 않음
  if(lastSeq === null){ lastSeq = ev.seq; return; }
  if(ev.seq === lastSeq) return;
  lastSeq = ev.seq;

  if(ev.type === "pass"){
    flyBomb(ev.from, ev.to);
    if(ev.to === myId){ toast("💣 폭탄이 넘어왔다!"); buzz(80); }
  }

  if(ev.type === "start"){
    toast(ev.to === myId ? "💣 내가 먼저 폭탄을 받았다!" : "게임 시작!");
    if(ev.to === myId) buzz(80);
  }

  if(ev.type === "explode"){
    const bomb = $("bomb");
    bomb.classList.remove("tense","critical","idle");
    bomb.classList.add("boom");
    $("flash").classList.remove("on");
    void $("flash").offsetWidth;
    $("flash").classList.add("on");

    const li = document.querySelector(`#players li[data-id="${CSS.escape(ev.from)}"]`);
    if(li){ li.classList.add("hit"); }

    toast(ev.from === myId ? "💥 내가 터졌다..." : `💥 ${ev.name} 탈락!`, 2200);
    buzz(ev.from === myId ? [200,80,300] : 120);

    setTimeout(() => {
      bomb.classList.remove("boom");
      if(lastState && lastState.status === "finished") bomb.className = "bomb off";
      else {
        bomb.className = "bomb idle";
        if(ev.to) flyBomb(ev.from, ev.to);
      }
    }, 650);
  }

  if(ev.type === "reset"){
    toast("새 게임을 준비해요");
  }
}

// 폭탄이 이전 사람 → 다음 사람 칸으로 날아가는 애니메이션
function flyBomb(fromId, toId){
  const a = document.querySelector(`#players li[data-id="${CSS.escape(fromId || "")}"] .bi`);
  const b = document.querySelector(`#players li[data-id="${CSS.escape(toId || "")}"] .bi`);
  if(!b || !a || !a.animate) return;

  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  const x1 = ra.left + ra.width / 2 - 17, y1 = ra.top + ra.height / 2 - 17;
  const x2 = rb.left + rb.width / 2 - 17, y2 = rb.top + rb.height / 2 - 17;
  const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - 50;

  const el = document.createElement("div");
  el.className = "fly";
  el.textContent = "💣";
  document.body.appendChild(el);

  // 도착 칸의 💣는 비행이 끝날 때까지 숨김
  b.style.visibility = "hidden";

  const anim = el.animate([
    { transform: `translate(${x1}px,${y1}px) scale(1) rotate(0deg)` },
    { transform: `translate(${mx}px,${my}px) scale(1.6) rotate(180deg)`, offset: .5 },
    { transform: `translate(${x2}px,${y2}px) scale(1) rotate(360deg)` }
  ], { duration: 650, easing: "ease-in-out" });

  const done = () => { el.remove(); b.style.visibility = ""; };
  anim.onfinish = done;
  anim.oncancel = done;
}

/* ---------- 타이머: 하나의 루프만 사용 (중복 실행/증가 버그 방지) ---------- */
setInterval(() => {
  const s = lastState;
  const bomb = $("bomb");
  if(!s || s.status !== "playing" || !s.startedAt) return;

  const left = s.startedAt + s.duration - now();

  if(!bomb.classList.contains("boom")){
    const critical = left < 2500, tense = left < 6000;
    bomb.classList.toggle("critical", critical);
    bomb.classList.toggle("tense", tense && !critical);
    bomb.classList.toggle("idle", !tense);
  }

  if(left <= 0 && !exploding && s.hostId===myId){
    // 폭탄 주인이 먼저 처리하고, 연결이 끊긴 경우에 대비해 다른 사람은 1.5초 뒤 대신 처리
    const wait = s.bombHolder === myId ? 0 : 1500;
    if(left <= -wait){
      exploding = true;
      explode().finally(() => setTimeout(() => { exploding = false; }, 800));
    }
  }
}, 150);

/* ---------- 이벤트 연결 ---------- */
$("createBtn").addEventListener("click", createRoom);
$("joinBtn").addEventListener("click", () => joinRoom());
$("startBtn").addEventListener("click", startGame);
$("passBtn").addEventListener("click", passBomb);
$("restartBtn").addEventListener("click", restartGame);
$("leaveBtn").addEventListener("click", () => { if(confirm("방에서 나갈까요?")) leaveRoom(); });
$("resultLeaveBtn").addEventListener("click", leaveRoom);
$("roomInput").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase(); });
$("roomInput").addEventListener("keydown", e => { if(e.key === "Enter") joinRoom(); });
$("name").addEventListener("keydown", e => { if(e.key === "Enter") createRoom(); });

$("roomCodeBox").addEventListener("click", async () => {
  try{
    await navigator.clipboard.writeText(roomId);
    $("copyHint").textContent = "복사됨 ✓";
  }catch(e){
    $("copyHint").textContent = "직접 복사";
  }
  setTimeout(() => { $("copyHint").textContent = "복사"; }, 1500);
});

// 새로고침해도 방으로 자동 복귀
$("name").value = store.get("bombName") || store.lget("bombName") || "";
const savedRoom = store.get("bombRoom");
if(savedRoom) joinRoom(savedRoom);
