// FSM Tool - finite state machine model, label syntax, undo, examples
//
// fsm   = { format, name, vars, initial, initAngle, states:[state], transitions:[trans] }
// state = { id, label, x, y, accepting }
// trans = { id, from, to, event, guard, action, bend, loopAngle }
//
// A transition label is written like in UML / statecharts:
//      event [guard] / action          e.g.   coin [credit < 200] / credit := credit + 100
// "event" may list several events: "a, b". guard and action are optional.
// guard: boolean expression over the variables (expr.js), action: statements "x := e; y++"
"use strict";

const Fsm = {
	fsm:null,
	version:0,
	listeners:[],
	undoStack:[], redoStack:[],
	nextId:1,
	uid(prefix="t") { return prefix+(this.nextId++); },

	load(f) {
		this.fsm=f;
		this.normalize(f);
		this.undoStack=[]; this.redoStack=[];
		this.changed("load");
	},
	normalize(f) {
		f.states=f.states||[]; f.transitions=f.transitions||[];
		if (f.vars===undefined) f.vars="";
		if (f.initAngle===undefined) f.initAngle=Math.PI;
		const ids=new Set();
		[...f.states,...f.transitions].forEach(o=>{
			if (!o.id || ids.has(o.id)) o.id=this.uid(f.states.includes(o)?"s":"t");
			ids.add(o.id);
			const k=parseInt(String(o.id).slice(1)); if (k>=this.nextId) this.nextId=k+1;
		});
		f.transitions.forEach(t=>{
			if (t.guard===undefined) t.guard="";
			if (t.action===undefined) t.action="";
			if (t.bend===undefined) t.bend=0;
			if (t.loopAngle===undefined) t.loopAngle=-Math.PI/2;
		});
		f.states.forEach(s=>{ if (s.accepting===undefined) s.accepting=false; });
		if (f.initial && !this.state(f.initial,f)) f.initial=null;
		if (!f.initial && f.states.length) f.initial=f.states[0].id;
	},
	toJSON() { return JSON.stringify(this.fsm,null,1); },
	fromJSON(s) {
		const f=JSON.parse(s);
		if (!f || !Array.isArray(f.states)) throw new Error("not an FSM file");
		return f;
	},
	changed(what) {
		this.version++;
		this.listeners.forEach(l=>{ try { l(what); } catch(e) { console.error(e); } });
		try { localStorage.setItem("fsm-tool-project",this.toJSON()); } catch(e) {}
	},
	edit(label,fn) {
		const before=JSON.stringify(this.fsm);
		let r;
		try { r=fn(); }
		catch(e) { this.fsm=JSON.parse(before); this.changed("error"); throw e; }
		if (r===false) return false;
		if (JSON.stringify(this.fsm)===before) return r;
		this.undoStack.push(before);
		if (this.undoStack.length>300) this.undoStack.shift();
		this.redoStack=[];
		this.changed(label);
		return r;
	},
	// for dragging: remember the state before the drag, commit once at the end
	beginDrag() { this.dragBefore=JSON.stringify(this.fsm); },
	endDrag() {
		if (this.dragBefore && this.dragBefore!==JSON.stringify(this.fsm)) {
			this.undoStack.push(this.dragBefore); this.redoStack=[];
			this.changed("drag");
		}
		this.dragBefore=null;
	},
	undo() {
		if (!this.undoStack.length) return false;
		this.redoStack.push(JSON.stringify(this.fsm));
		this.fsm=JSON.parse(this.undoStack.pop());
		this.changed("undo"); return true;
	},
	redo() {
		if (!this.redoStack.length) return false;
		this.undoStack.push(JSON.stringify(this.fsm));
		this.fsm=JSON.parse(this.redoStack.pop());
		this.changed("redo"); return true;
	},

	/* ---------------- queries ---------------- */
	state(id,f=this.fsm) { return f.states.find(s=>s.id===id)||null; },
	trans(id) { return this.fsm.transitions.find(t=>t.id===id)||null; },
	stateByLabel(label) { const l=String(label).trim().toLowerCase(); return this.fsm.states.find(s=>s.label.trim().toLowerCase()===l)||null; },
	events(t) { return String(t.event).split(/[,;]/).map(e=>e.trim()).filter(e=>e!==""); },
	// all events used on transitions (the input alphabet), in order of appearance
	alphabet() {
		const out=[];
		this.fsm.transitions.forEach(t=>this.events(t).forEach(e=>{ if (!out.includes(e)) out.push(e); }));
		return out;
	},
	labelOf(t) {
		let s=t.event||"";
		if (t.guard && t.guard.trim()) s+=(s?" ":"")+"["+t.guard.trim()+"]";
		if (t.action && t.action.trim()) s+=" / "+t.action.trim();
		return s.trim()||"ε?";
	},
	// "a, b [x > 0] / x++"  ->  {event, guard, action}
	parseLabel(text) {
		let s=String(text).trim(), guard="", action="";
		let sl=-1, depth=0;          // the first "/" outside [ ] and ( )
		for (let i=0;i<s.length;i++) {
			const ch=s[i];
			if (ch==="["||ch==="(") depth++;
			else if (ch==="]"||ch===")") depth--;
			else if (ch==="/" && depth===0 && s[i+1]!=="=") { sl=i; break; }
		}
		if (sl>=0) { action=s.slice(sl+1).trim(); s=s.slice(0,sl).trim(); }
		const m=s.match(/^([\s\S]*?)\[([\s\S]*)\]\s*$/);
		if (m) { guard=m[2].trim(); s=m[1].trim(); }
		return { event:s, guard, action };
	},

	/* ---------------- editing ---------------- */
	newStateLabel() {
		let k=this.fsm.states.length;
		while (this.stateByLabel("S"+k)) k++;
		return "S"+k;
	},
	addState(x,y,label) {
		const s={ id:this.uid("s"), label:label||this.newStateLabel(), x:Math.round(x), y:Math.round(y), accepting:false };
		this.fsm.states.push(s);
		if (!this.fsm.initial) this.fsm.initial=s.id;
		return s;
	},
	addTransition(from,to,label="") {
		const p=this.parseLabel(label);
		const t={ id:this.uid("t"), from, to, event:p.event, guard:p.guard, action:p.action, bend:0, loopAngle:-Math.PI/2 };
		// parallel arrows in the same direction: fan them out
		const same=this.fsm.transitions.filter(x=>x.from===from && x.to===to);
		if (same.length) {
			if (from===to) t.loopAngle=-Math.PI/2+same.length*Math.PI/3;
			else t.bend=40*same.length*(same.length%2?1:-1);
		}
		this.fsm.transitions.push(t);
		return t;
	},
	deleteState(id) {
		this.fsm.states=this.fsm.states.filter(s=>s.id!==id);
		this.fsm.transitions=this.fsm.transitions.filter(t=>t.from!==id && t.to!==id);
		if (this.fsm.initial===id) this.fsm.initial=this.fsm.states.length?this.fsm.states[0].id:null;
	},
	deleteTransition(id) { this.fsm.transitions=this.fsm.transitions.filter(t=>t.id!==id); },
	setLabel(t,text) { Object.assign(t,this.parseLabel(text)); },
};

/* ------------------------------------------------------------------ */
/* examples                                                            */
/* ------------------------------------------------------------------ */
function fsmBuild(name,vars,states,trans,initial,initAngle=Math.PI) {
	const f={ format:"fsm-tool/1", name, vars, initAngle, states:[], transitions:[] };
	const byLabel={};
	states.forEach(([label,x,y,acc],i)=>{ const s={id:"s"+(i+1),label,x,y,accepting:!!acc}; f.states.push(s); byLabel[label]=s.id; });
	trans.forEach(([a,b,label,bend,loop],i)=>{
		const p=Fsm.parseLabel(label);
		f.transitions.push({ id:"t"+(i+1), from:byLabel[a], to:byLabel[b], event:p.event, guard:p.guard, action:p.action, bend:bend||0, loopAngle:loop!==undefined?loop:-Math.PI/2 });
	});
	f.initial=byLabel[initial];
	return f;
}
const FSM_EXAMPLES = [
	{ name:"Turnstile (coin / push)", input:"coin push push coin coin push", make:()=>fsmBuild("Turnstile","",
		[["Locked",220,220],["Unlocked",520,220]],
		[["Locked","Unlocked","coin",40],["Unlocked","Locked","push",40],["Locked","Locked","push",0,-Math.PI/2],["Unlocked","Unlocked","coin",0,-Math.PI/2]],
		"Locked") },
	{ name:"Binary numbers divisible by 3", input:"110", make:()=>fsmBuild("Divisible by 3","",
		[["r0",180,240,true],["r1",400,240],["r2",620,240]],
		[["r0","r0","0",0,-Math.PI/2],["r0","r1","1",35],["r1","r0","1",35],["r1","r2","0",35],["r2","r1","0",35],["r2","r2","1",0,-Math.PI/2]],
		"r0") },
	{ name:"Ends with 'ab'", input:"a b b a a b", make:()=>fsmBuild("Ends with ab","",
		[["q0",180,260],["q1",400,260],["q2",620,260,true]],
		[["q0","q0","b",0,-Math.PI/2],["q0","q1","a",0],["q1","q1","a",0,-Math.PI/2],["q1","q2","b",35],["q2","q1","a",35],["q2","q0","b",-90]],
		"q0") },
	{ name:"Coffee machine (guards)", input:"", make:()=>fsmBuild("Coffee machine","credit := 0",
		[["Idle",180,250],["Paying",460,250],["Brewing",740,250]],
		[["Idle","Paying","coin / credit := credit + 100",0],
		 ["Paying","Paying","coin / credit := credit + 100",0,-Math.PI/2],
		 ["Paying","Brewing","button [credit >= 200] / credit := credit - 200",35],
		 ["Paying","Paying","button [credit < 200]",0,Math.PI/2],
		 ["Brewing","Paying","done [credit > 0]",35],
		 ["Brewing","Idle","done [credit = 0]",-110]],
		"Idle") },
];

if (typeof module!=="undefined") module.exports={ Fsm, FSM_EXAMPLES, fsmBuild };
