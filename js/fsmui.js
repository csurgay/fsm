// FSM Tool - simulation window (input, tape, stepping, event buttons) and properties window
"use strict";

const FsmCtl = {
	sim:new FsmSim(),
	running:false,
	delay:700,
	loopTimer:null,
	view:null, win:null,
	init() {
		this.sim.on((ev)=>{ if (ev.type==="fire") this.animate(ev.trans); invalidate(); });
	},
	inputText() { return this.win ? this.win.inputField.value : ""; },
	load(text) { this.pause(); WM.commitEdit(); this.sim.reset(text); this.sim.addLog("input loaded: "+(this.sim.tokens.length?this.sim.tokens.join(" "):"(empty)"),THEME.textDim); invalidate(); },
	reset() { this.pause(); this.sim.reset(this.inputText()); this.sim.addLog("reset",THEME.textDim); invalidate(); },
	step() {
		WM.commitEdit();
		if (this.sim.isFinal()) { this.pause(); return false; }
		if (this.sim.next()===null) { this.pause(); if (!this.sim.tokens.length) this.sim.addLog("the input is empty – type a sequence or use the event buttons",THEME.textDim); invalidate(); return false; }
		const ok=this.sim.step();
		invalidate();
		return ok;
	},
	back() { this.pause(); this.sim.back(); invalidate(); },
	run() {
		if (this.running) { this.pause(); return; }
		if (this.sim.next()===null || this.sim.isFinal()) { this.sim.reset(this.inputText()); }
		this.running=true; this.loop(); invalidate();
	},
	pause() { this.running=false; clearTimeout(this.loopTimer); invalidate(); },
	loop() {
		if (!this.running) return;
		if (!this.step()) { this.pause(); return; }
		this.loopTimer=setTimeout(()=>this.loop(),this.delay);
	},
	faster() { this.delay=Math.max(80,Math.round(this.delay/1.5)); invalidate(); },
	slower() { this.delay=Math.min(4000,Math.round(this.delay*1.5)); invalidate(); },
	manual(ev) { this.pause(); WM.commitEdit(); this.sim.manual(ev); invalidate(); },
	// a token runs along the arrow that fired
	animate(t) {
		const v=this.view; if (!v || !v.treeVisible()) return;
		const g=v.geom(t); if (!g) return;
		const dur=Math.max(150,Math.min(700,this.delay*0.7));
		WM.animations.push({ t0:performance.now(), dur, paint:(k)=>{
			const e=k<0.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
			const p=v.toScreen(cubicAt(g,e));
			v.absolute();
			if (p.x<v.ax||p.y<v.ay||p.x>v.ax+v.w||p.y>v.ay+v.h) return;
			ctx.save();
			ctx.beginPath(); ctx.arc(p.x,p.y,7*Math.max(0.7,v.z),0,Math.PI*2);
			ctx.fillStyle="#ffb300"; ctx.fill(); ctx.strokeStyle="#8a5a00"; ctx.lineWidth=1.5; ctx.stroke();
			ctx.restore();
		}});
	},
	highlight() {
		const s=this.sim, nt=s.nextTransition();
		return { active:s.state, lastTrans:s.lastTrans, nextTrans:nt?nt.id:null, stuck:s.isFinal(), accepted:s.status==="accepted" };
	},
	statusText() {
		const s=this.sim;
		const st={ ready:"ready", running:"running", done:"end of input", accepted:"ACCEPTED", rejected:"REJECTED", stuck:"STUCK – rejected", error:"ERROR" }[s.status]||s.status;
		return "State: "+(s.state?s.stateLabel(s.state):"-")+"      "+st+(this.running?"   ▶":"")+"      step "+s.pos+"/"+s.tokens.length;
	},
};

/* ------------------------------------------------------------------ */
/* the input tape: consumed / current / remaining symbols              */
/* ------------------------------------------------------------------ */
class TapeView extends Area {
	constructor() { super(0,0,10,46); this.class="TapeView"; }
	paint() {
		const s=FsmCtl.sim;
		c.fillRect(this.ax,this.ay,this.w,this.h,"#ffffff");
		c.rect(this.ax+0.5,this.ay+0.5,this.w-1,this.h-1,"#b5bcc5");
		if (!s.tokens.length) {
			c.fillText("(empty input – type a sequence above, or use the event buttons)",this.ax+10,this.ay+this.h/2,"left",THEME.textDim);
			return;
		}
		ctx.font=THEME.fontBold;
		const ws=s.tokens.map(t=>Math.max(30,ctx.measureText(t).width+16));
		const x0=[]; let acc=0; ws.forEach(w=>{ x0.push(acc); acc+=w+4; });
		// keep the current cell visible
		const cur=Math.min(s.pos,s.tokens.length-1);
		let off=0;
		const want=x0[cur]+ws[cur]+60;
		if (want>this.w-16) off=want-(this.w-16);
		const cy=this.ay+6;
		s.tokens.forEach((t,i)=>{
			const x=this.ax+8+x0[i]-off, w=ws[i];
			if (x+w<this.ax || x>this.ax+this.w) return;
			let bg="#ffffff", fg=THEME.text, bd="#9aa3ad";
			if (i<s.pos) { bg="#eef0f3"; fg=THEME.textDim; }
			if (i===s.pos && !s.isFinal()) { bg="#ffe58a"; bd="#b07d00"; }
			if (i===s.failed) { bg="#ffd6d6"; bd="#c01818"; fg="#c01818"; }
			c.roundRect(x,cy,w,24,3,bg,bd);
			c.fillText(t,x+w/2,cy+12.5,"center",fg,i===s.pos?THEME.fontBold:THEME.font);
		});
		// the read head
		const hi=Math.min(s.pos,s.tokens.length);
		const hx=hi<s.tokens.length ? this.ax+8+x0[hi]-off+ws[hi]/2 : this.ax+8+acc-off+6;
		ctx.fillStyle=s.isFinal()?"#c01818":"#b07d00";
		ctx.beginPath(); ctx.moveTo(hx,cy+27); ctx.lineTo(hx-6,cy+37); ctx.lineTo(hx+6,cy+37); ctx.closePath(); ctx.fill();
		if (hi>=s.tokens.length) c.fillText("end",hx+10,cy+33,"left",THEME.textDim,THEME.fontSmall);
	}
}

// one button per event of the alphabet, rebuilt when the alphabet changes
class EventBar extends Area {
	constructor() { super(0,0,10,30); this.class="EventBar"; this.key=null; }
	rebuild() {
		const alpha=Fsm.fsm?Fsm.alphabet():[];
		const key=alpha.join("\u0001")+"|"+this.w;
		if (key===this.key) return;
		this.key=key;
		this.children.slice().forEach(ch=>this.remove(ch));
		let x=0, y=0;
		alpha.forEach(ev=>{
			const b=new Button(ev,0,0,0,24,()=>FsmCtl.manual(ev),{
				enabled:()=>FsmCtl.inputText().trim()==="" && !FsmCtl.sim.isFinal() && !(WM.editing && WM.editing.owner===FsmCtl.win.inputField),
				toggled:()=>b.isEnabled() && FsmCtl.sim.possible(ev),
				tooltip:"fire '"+ev+"'  (only when the input box is empty)",
			});
			b.w=Math.max(40,b.w);
			if (x>0 && x+b.w>this.w) { x=0; y+=28; }
			b.x=x; b.y=y; x+=b.w+4;
			this.push(b);
		});
		if (!alpha.length) this.push(new Label("(no events yet – write them on the arrows)",0,0,300,24,{color:THEME.textDim}));
		this.h=y+28;
	}
	paint() { this.rebuild(); }
}

class SimWindow extends Window {
	constructor(prect) {
		super("Simulation",prect,CLOSABLE,RESIZABLE,{minW:340,minH:260});
		this.class="SimWindow";
		this.push(new Label("Input:",8,8,48,22,{font:THEME.fontBold}));
		this.inputField=this.push(new TextField("",58,6,200,24,{
			placeholder:"events, e.g.  coin push push   or   0110",
			onEnter:(v)=>FsmCtl.load(v), onChange:(v)=>FsmCtl.load(v),
		}));
		this.loadBtn=this.push(new Button("Load",0,6,56,24,()=>{ WM.commitEdit(); FsmCtl.load(this.inputField.value); },{tooltip:"Load the input and reset"}));
		this.tape=this.push(new TapeView());
		const b=(cap,fn,tip,opts={})=>this.push(new Button(cap,0,0,0,24,fn,Object.assign({tooltip:tip},opts)));
		this.btns=[
			b("Reset",()=>FsmCtl.reset(),"Back to the initial state (F9)"),
			b("◀ Back",()=>FsmCtl.back(),"Undo the last step (Shift+F10)",{enabled:()=>FsmCtl.sim.history.length>0}),
			b("Step ▶",()=>FsmCtl.step(),"Take the next input symbol (F10)",{enabled:()=>FsmCtl.sim.next()!==null && !FsmCtl.sim.isFinal()}),
			b("Run",()=>FsmCtl.run(),"Run / pause (F8)",{toggled:()=>FsmCtl.running}),
			b("Slower",()=>FsmCtl.slower(),"Longer delay"),
			b("Faster",()=>FsmCtl.faster(),"Shorter delay"),
		];
		this.status=this.push(new Label(()=>FsmCtl.statusText(),8,0,300,20,{font:THEME.fontBold}));
		this.varsLabel=this.push(new Label(()=>{ const v=FsmCtl.sim.vars, k=Object.keys(v); return k.length?"Variables:  "+k.map(n=>n+" = "+Expr.toText(v[n])).join(",   "):(FsmCtl.sim.msg||""); },8,0,300,18,{font:THEME.fontMono}));
		this.evLabel=this.push(new Label("Events:",8,0,56,24,{font:THEME.fontBold}));
		this.events=this.push(new EventBar());
		this.logView=this.push(new ListView(0,0,10,10,{ items:()=>FsmCtl.sim.log, stickBottom:true, font:THEME.fontSmall, rowH:16 }));
		this.layout();
	}
	onLayout() {
		if (!this.logView) return;
		const W=this.clientArea.w, H=this.clientArea.h;
		this.loadBtn.x=W-6-this.loadBtn.w;
		this.inputField.w=Math.max(60,this.loadBtn.x-4-58);
		this.tape.set(6,36,W-12,46);
		let x=6;
		this.btns.forEach(bt=>{ bt.x=x; bt.y=88; x+=bt.w+4; });
		this.status.set(8,118,W-16,20);
		this.varsLabel.set(8,138,W-16,18);
		this.evLabel.set(8,162,56,24);
		this.events.set(66,162,W-72,this.events.h);
		this.events.key=null; this.events.rebuild();
		const ly=162+Math.max(28,this.events.h)+6;
		this.logView.set(4,ly,W-8,Math.max(20,H-ly-4));
	}
	paint() {
		// the event bar may have grown a row
		const ly=162+Math.max(28,this.events.h)+6;
		if (this.logView.y!==ly) this.onLayout();
	}
}

/* ------------------------------------------------------------------ */
/* properties of the selection (and of the machine)                    */
/* ------------------------------------------------------------------ */
class PropsWindow extends Window {
	constructor(prect) {
		super("Properties",prect,CLOSABLE,RESIZABLE,{minW:240,minH:160});
		this.class="PropsWindow";
		this.key=null;
		this.bindings=[];
		this.layout();
	}
	selKey() {
		const v=FsmCtl.view, s=v&&v.sel;
		if (!s || s.kind==="init") return "machine";
		if (!v.selected()) return "machine";
		return s.kind+":"+s.id;
	}
	rebuild() {
		const key=this.selKey();
		if (key===this.key && this.builtW===this.clientArea.w) return;
		this.key=key; this.builtW=this.clientArea.w;
		const ca=this.clientArea;
		ca.children.slice().forEach(ch=>{ if (ch!==ca.resizeArea) ca.remove(ch); });
		this.bindings=[];
		const W=ca.w;
		let y=8;
		const title=(t)=>{ this.push(new Label(t,8,y,W-16,20,{font:THEME.fontBold})); y+=24; };
		const field=(label,get,set,ph)=>{
			this.push(new Label(label,8,y+2,70,20));
			const tf=this.push(new TextField(get(),80,y,W-88,24,{placeholder:ph||"",onChange:(v)=>{ try { Fsm.edit("prop",()=>set(v)); } catch(e) { WM.message("Error",e.message); } }}));
			this.bindings.push({tf,get});
			y+=30;
		};
		const hint=(t,color=THEME.textDim)=>{ this.push(new Label(t,8,y,W-16,16,{font:THEME.fontSmall,color})); y+=16; };
		const buttons=(list)=>{ let x=8; list.forEach(([cap,fn,opts])=>{ const bt=this.push(new Button(cap,x,y,0,24,fn,opts||{})); x+=bt.w+4; }); y+=32; };
		const view=FsmCtl.view;
		if (key==="machine") {
			title("Machine");
			field("Name:",()=>Fsm.fsm.name,(v)=>{ Fsm.fsm.name=v.trim()||"Untitled"; });
			field("Variables:",()=>Fsm.fsm.vars,(v)=>{ Fsm.fsm.vars=v; },"e.g.  credit := 0, n");
			y+=2;
			this.push(new Label(()=>"States: "+Fsm.fsm.states.length+"    transitions: "+Fsm.fsm.transitions.length,8,y,W-16,18)); y+=20;
			this.push(new Label(()=>"Alphabet: { "+Fsm.alphabet().join(", ")+" }",8,y,W-16,18)); y+=26;
			hint("Transition label:   event [guard] / action");
			hint("  guard: condition over the variables, e.g.  n < 3");
			hint("  action: statements, e.g.  n := n + 1;  m++");
		}
		else if (key.startsWith("state:")) {
			const id=view.sel.id, st=()=>Fsm.state(id);
			title("State");
			field("Label:",()=>st()?st().label:"",(v)=>{ if (v.trim()) st().label=v.trim(); });
			buttons([
				["Accepting",()=>view.toggleAccepting(id),{toggled:()=>!!(st()&&st().accepting),tooltip:"Accepting (final) state – double circle (A)"}],
				["Initial",()=>view.setInitial(id),{toggled:()=>Fsm.fsm.initial===id,tooltip:"Make it the initial state (I)"}],
				["Delete",()=>view.deleteSelected(),{}],
			]);
			hint("Drag from the rim of the state to draw a transition.");
		}
		else if (key.startsWith("trans:")) {
			const id=view.sel.id, tr=()=>Fsm.trans(id);
			this.push(new Label(()=>{ const t=tr(); return t?"Transition   "+Fsm.state(t.from).label.replace(/\n/g," ")+"  →  "+Fsm.state(t.to).label.replace(/\n/g," "):""; },8,y,W-16,20,{font:THEME.fontBold})); y+=26;
			field("Event:",()=>tr()?tr().event:"",(v)=>{ tr().event=v.trim(); },"e.g.  coin   or   a, b");
			field("Guard:",()=>tr()?tr().guard:"",(v)=>{ const g=v.trim(); if (g) Expr.parse(g); tr().guard=g; },"optional, e.g.  credit >= 200");
			field("Action:",()=>tr()?tr().action:"",(v)=>{ const a=v.trim(); if (a) Expr.parseStatements(a); tr().action=a; },"optional, e.g.  credit := credit - 200");
			buttons([
				["Straighten",()=>view.doEdit("bend",()=>{ tr().bend=0; }),{enabled:()=>!!(tr()&&tr().from!==tr().to)}],
				["Reverse",()=>view.doEdit("reverse",()=>{ const t=tr(); [t.from,t.to]=[t.to,t.from]; }),{}],
				["Delete",()=>view.deleteSelected(),{}],
			]);
			hint("Guard and action are checked when you enter them.");
		}
		this.clientArea.layout();
		invalidate();
	}
	paint() {
		this.rebuild();
		this.bindings.forEach(b=>{ if (!(WM.editing && WM.editing.owner===b.tf)) { const v=b.get(); if (v!==undefined) b.tf.value=v; } });
	}
}
