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

// Several machines can be open at the same time. Each one is a "doc":
//   doc = { id, fsm, undoStack, redoStack, input, sim, view, win, running, timer }
// Fsm.doc is the current doc: Fsm.fsm, Fsm.undoStack ... always refer to it.
// Fsm.within(doc, fn) runs fn with another doc as the current one (painting an
// inactive window, a simulation running in the background).
const Fsm = {
	docs:[],
	doc:null,
	version:0,
	listeners:[],
	nextId:1,
	nextDocId:1,
	get fsm() { return this.doc ? this.doc.fsm : null; },
	set fsm(f) { this.doc.fsm=f; },
	get undoStack() { return this.doc ? this.doc.undoStack : []; },
	set undoStack(a) { this.doc.undoStack=a; },
	get redoStack() { return this.doc ? this.doc.redoStack : []; },
	set redoStack(a) { this.doc.redoStack=a; },
	uid(prefix="t") { return prefix+(this.nextId++); },

	newDoc(f,input="") {
		const doc={ id:"d"+(this.nextDocId++), fsm:f, undoStack:[], redoStack:[], input:input||"", sim:null, view:null, win:null, running:false, timer:null };
		this.normalize(f);
		this.docs.push(doc);
		return doc;
	},
	closeDoc(doc) {
		this.docs=this.docs.filter(d=>d!==doc);
		if (this.doc===doc) this.doc=this.docs[this.docs.length-1]||null;
		this.persist();
	},
	within(doc,fn) {
		if (!doc || doc===this.doc) return fn();
		const prev=this.doc;
		this.doc=doc;
		try { return fn(); } finally { this.doc=prev; }
	},
	// all open machines (and their inputs) survive a page reload
	persist() {
		try {
			localStorage.setItem("fsm-tool-docs",JSON.stringify(this.docs.map(d=>({ fsm:d.fsm, input:d.input }))));
			localStorage.setItem("fsm-tool-active",String(Math.max(0,this.docs.indexOf(this.doc))));
		} catch(e) {}
	},
	restore() {
		try {
			const s=localStorage.getItem("fsm-tool-docs");
			if (s) return { docs:JSON.parse(s).filter(d=>d && d.fsm && Array.isArray(d.fsm.states)), active:parseInt(localStorage.getItem("fsm-tool-active"))||0 };
			const old=localStorage.getItem("fsm-tool-project");     // the single-machine version
			if (old) return { docs:[{ fsm:this.fromJSON(old), input:localStorage.getItem("fsm-tool-input")||"" }], active:0 };
		} catch(e) {}
		return { docs:[], active:0 };
	},

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
		this.persist();
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
/* examples: every *.fsm.json file in the examples/ directory          */
/* ------------------------------------------------------------------ */
// The file list comes from examples/index.json (generated at deploy time,
// or locally with  node tools/examples-index.js) and, if the web server shows
// directory listings (python -m http.server, VS Code Live Server, Apache),
// also from the listing itself - so a file just dropped in is found too.
// The menu is ordered by file name; the menu text is the "name" of the machine.
const Examples = {
	dir:"examples/",
	list:[],          // { file, name, text }
	loaded:false,
	error:"",
	async load() {
		let names=[];
		try {
			const r=await fetch(this.dir+"index.json",{cache:"no-cache"});
			if (r.ok) { const j=await r.json(); if (Array.isArray(j)) names.push(...j.map(String)); }
		} catch(e) {}
		try {
			const r=await fetch(this.dir,{cache:"no-cache"});
			if (r.ok) {
				const html=await r.text();
				for (const m of html.matchAll(/href\s*=\s*["']([^"'?#]+\.fsm\.json)["']/gi)) names.push(decodeURIComponent(m[1].split("/").pop()));
			}
		} catch(e) {}
		names=[...new Set(names.filter(n=>/\.fsm\.json$/i.test(n)))].sort((a,b)=>a.localeCompare(b));
		const got=await Promise.all(names.map(async file=>{
			try {
				const r=await fetch(this.dir+encodeURIComponent(file),{cache:"no-cache"});
				if (!r.ok) return null;
				const text=await r.text();
				const f=Fsm.fromJSON(text);
				return { file, name:(f.name||file.replace(/\.fsm\.json$/i,"")).trim(), text };
			} catch(e) { console.warn("example "+file+": "+e.message); return null; }
		}));
		this.list=got.filter(Boolean);
		if (!this.list.length) this.error=location.protocol==="file:" ? "open the tool through a web server to see the examples" : "no *.fsm.json files found in "+this.dir;
		this.loaded=true;
		return this.list;
	},
	// a fresh copy every time
	make(ex) { const f=Fsm.fromJSON(ex.text); return { fsm:f, input:f.input||"" }; },
};

if (typeof module!=="undefined") module.exports={ Fsm, Examples };
