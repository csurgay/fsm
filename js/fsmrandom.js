// FSM Tool - random simulation of all open machines
//
// Every machine starts from its initial state and in each step takes an event
// chosen at random from the events that are possible now (an outgoing transition
// with that event and a true guard). A machine with no possible event (dead end,
// stuck, error) starts again from its initial state.
// A small control window: Suspend, Resume, Slower, Faster, Quit.
"use strict";

const RandomSim = {
	on:false,
	suspended:false,
	timer:null,
	steps:0,
	win:null,
	saved:new Map(),        // doc -> the input it had before, given back at Quit
	prepared:new Set(),

	start() {
		if (this.on) { if (this.win) this.win.activate(); return; }
		WM.commitEdit();
		this.on=true; this.suspended=false; this.steps=0;
		this.saved.clear(); this.prepared.clear();
		Fsm.docs.forEach(d=>this.prepare(d));
		if (FsmCtl.win) FsmCtl.win.inputField.value="";
		this.openWindow();
		this.schedule();
		invalidate();
	},
	// the machine starts again from its initial state with an empty tape
	prepare(d) {
		FsmCtl.pause(d);
		if (!this.saved.has(d)) this.saved.set(d,d.input||"");
		d.input="";
		Fsm.within(d,()=>{
			d.sim.reset("");
			d.sim.quietEnd=true;
			d.sim.addLog("random simulation: started from the initial state",THEME.textDim);
		});
		this.prepared.add(d);
	},
	schedule() {
		clearTimeout(this.timer);
		if (this.on && !this.suspended) this.timer=setTimeout(()=>this.tick(),FsmCtl.delay);
	},
	tick() {
		if (!this.on || this.suspended) return;
		Fsm.docs.forEach(d=>{
			if (!this.prepared.has(d)) { this.prepare(d); return; }   // opened during the random run
			Fsm.within(d,()=>this.stepDoc(d));
		});
		this.steps++;
		invalidate();
		this.schedule();
	},
	stepDoc(d) {
		const s=d.sim;
		if (!s || !Fsm.fsm.states.length) return;
		if (s.isFinal() || !s.state) { s.reset(""); s.quietEnd=true; s.addLog("restart from the initial state",THEME.textDim); return; }
		let possible=[];
		try { possible=Fsm.alphabet().filter(ev=>s.possible(ev)); } catch(e) { possible=[]; }
		if (!possible.length) {
			s.addLog("dead end in "+s.stateLabel(s.state)+" (no possible event) – restart",THEME.textDim);
			s.status="stuck";      // shown red for one step, then restart
			return;
		}
		// keep the tape short: forget the consumed part
		if (s.tokens.length>=60) { s.tokens.splice(0,s.pos); s.pos=0; s.failed=-1; s.history=[]; }
		s.manual(possible[Math.floor(Math.random()*possible.length)]);
	},
	suspend() { this.suspended=true; clearTimeout(this.timer); invalidate(); },
	resume() { if (!this.on) return; this.suspended=false; this.schedule(); invalidate(); },
	quit() {
		if (!this.on) return;
		this.on=false; this.suspended=false;
		clearTimeout(this.timer);
		// the machines stay where they are; their own input comes back (Reset uses it)
		Fsm.docs.forEach(d=>{
			if (this.saved.has(d)) d.input=this.saved.get(d);
			if (d.sim) { d.sim.quietEnd=false; d.sim.addLog("random simulation finished – Reset goes back to the input",THEME.textDim); }
		});
		if (FsmCtl.win && Fsm.doc) FsmCtl.win.inputField.value=Fsm.doc.input||"";
		this.saved.clear(); this.prepared.clear();
		Fsm.persist();
		const w=this.win; this.win=null;
		if (w && w.father) { w.onClose=null; w.close(); }
		invalidate();
	},
	openWindow() {
		const W=330, H=ddhead+70;
		const w=new Window("Random simulation",new Rect(0,0,W,H),CLOSABLE,NOTRESIZABLE,{closeAction:"destroy"});
		let x=8;
		const b=(cap,fn,opts={})=>{ const bt=w.push(new Button(cap,x,8,0,24,fn,opts)); x+=bt.w+4; return bt; };
		b("Suspend",()=>this.suspend(),{enabled:()=>!this.suspended,tooltip:"Stop all machines for now"});
		b("Resume",()=>this.resume(),{enabled:()=>this.suspended,tooltip:"Go on"});
		b("Slower",()=>FsmCtl.slower(),{tooltip:"Longer delay between the steps"});
		b("Faster",()=>FsmCtl.faster(),{tooltip:"Shorter delay between the steps"});
		b("Quit",()=>this.quit(),{tooltip:"End the random simulation"});
		w.push(new Label(()=>(this.suspended?"suspended":"running")+"   ·   "+Fsm.docs.length+" machine(s)   ·   step "+this.steps+"   ·   "+FsmCtl.delay+" ms",8,40,W-16,18,{color:THEME.textDim,font:THEME.fontSmall}));
		w.onClose=()=>{ this.win=null; this.quit(); return true; };
		const ca=WM.root.clientArea;
		ca.push(w);
		w.setSize(Math.max(W,x+8),H);
		w.moveTo(Math.round((ca.w-w.w)/2),ca.h-w.h-12);
		w.activate();
		this.win=w;
	},
};
