// FSM Tool - simulator core (UI independent)
//
// The input is a sequence of events (tokens). One step takes the next token:
// the transitions leaving the active state with that event and a true guard are enabled;
// the first enabled one fires (its action runs), several enabled ones = nondeterminism warning,
// none = the machine is stuck (the input is rejected).
// At the end of the input the word is accepted if the active state is accepting.
"use strict";

class FsmSim {
	constructor() {
		this.listeners=[];
		this.ignoreUnhandled=false;   // false: automaton semantics (reject), true: reactive (ignore)
		this.reset("");
	}
	on(f) { this.listeners.push(f); }
	emit(ev) { this.listeners.forEach(f=>{ try { f(ev,this); } catch(e) { console.error(e); } }); }

	tokenize(text) {
		const s=String(text).trim();
		if (!s) return [];
		if (/[\s,;]/.test(s)) return s.split(/[\s,;]+/).filter(x=>x!=="");
		const alpha=Fsm.alphabet();
		if (alpha.includes(s)) return [s];
		return s.split("");                  // "abba" -> a b b a
	}
	reset(text) {
		this.input=text!==undefined?text:this.input;
		this.tokens=this.tokenize(this.input);
		this.pos=0;
		this.state=Fsm.fsm?Fsm.fsm.initial:null;
		this.vars={};
		this.history=[];
		this.lastTrans=null;
		this.failed=-1;
		this.status="ready";
		this.msg="";
		this.log=[];
		try {
			if (Fsm.fsm && Fsm.fsm.vars && Fsm.fsm.vars.trim())
				Expr.parseDcl(Fsm.fsm.vars).forEach(d=>{ this.vars[d.name]=d.init?Expr.evaluate(d.init,this.scope()):0; });
		} catch(e) { this.status="error"; this.msg="variables: "+e.message; }
		if (!this.state && Fsm.fsm && Fsm.fsm.states.length) { this.status="error"; this.msg="no initial state"; }
		this.emit({type:"reset"});
	}
	scope() {
		const v=this.vars;
		return {
			get(name,raw) { if (Object.prototype.hasOwnProperty.call(v,name)) return v[name]; throw new SdlError("undefined variable '"+(raw||name)+"' (declare it in Variables)"); },
			call(name,args) {
				switch (name) {
					case "random": { const a=Math.ceil(args[0]), b=Math.floor(args.length>1?args[1]:args[0]); return a+Math.floor(Math.random()*(b-a+1)); }
					case "abs": return Math.abs(args[0]);
					case "min": return Math.min(...args);
					case "max": return Math.max(...args);
				}
				throw new SdlError("unknown function "+name+"()");
			},
		};
	}
	stateLabel(id) { const s=Fsm.state(id); return s?s.label.replace(/\n/g," "):"?"; }
	// transitions leaving the active state for this event (guards not yet checked)
	candidates(ev) {
		return Fsm.fsm.transitions.filter(t=>t.from===this.state && Fsm.events(t).includes(ev));
	}
	guardOk(t) {
		if (!t.guard || !t.guard.trim()) return true;
		return Expr.truthy(Expr.evaluate(Expr.parse(t.guard),this.scope()));
	}
	enabled(ev) { return this.candidates(ev).filter(t=>this.guardOk(t)); }
	// is the event possible now? (for the event buttons)
	possible(ev) { try { return !!this.state && this.enabled(ev).length>0; } catch(e) { return false; } }
	next() { return this.pos<this.tokens.length ? this.tokens[this.pos] : null; }
	nextTransition() {
		const ev=this.next();
		if (ev===null || this.isFinal()) return null;
		try { const en=this.enabled(ev); return en.length?en[0]:null; } catch(e) { return null; }
	}
	isFinal() { return ["stuck","error"].includes(this.status); }
	hasAccepting() { return Fsm.fsm.states.some(s=>s.accepting); }
	finishStatus() {
		if (this.pos<this.tokens.length) return "running";
		if (!this.hasAccepting()) return "done";
		const s=Fsm.state(this.state);
		return s && s.accepting ? "accepted" : "rejected";
	}
	addLog(text,color) { this.log.push({text,color}); if (this.log.length>1000) this.log.splice(0,200); }
	snapshot() { return { state:this.state, vars:JSON.stringify(this.vars), pos:this.pos, ntok:this.tokens.length, status:this.status, msg:this.msg, lastTrans:this.lastTrans, failed:this.failed }; }
	restore(s) {
		this.state=s.state; this.vars=JSON.parse(s.vars); this.pos=s.pos; this.tokens.length=s.ntok;
		this.status=s.status; this.msg=s.msg; this.lastTrans=s.lastTrans; this.failed=s.failed;
	}
	fire(ev,manual=false) {
		if (this.isFinal() || !this.state) return false;
		const snap=this.snapshot();
		if (manual) snap.ntok--;          // the token was appended just for this step
		let en;
		try { en=this.enabled(ev); }
		catch(e) { this.status="error"; this.msg="guard: "+e.message; this.failed=this.pos; this.addLog(this.msg,"#c01818"); this.emit({type:"error"}); return false; }
		if (!en.length && this.ignoreUnhandled) {
			this.history.push(snap);
			this.pos++;
			this.lastTrans=null;
			this.status=this.finishStatus();
			this.addLog("  '"+ev+"' ignored in "+this.stateLabel(this.state)+" (no enabled transition)","#a05a00");
			this.emit({type:"ignored",event:ev});
			return true;
		}
		if (!en.length) {
			this.history.push(snap);
			const why=this.candidates(ev).length?"all guards are false":"no transition";
			this.status="stuck"; this.failed=this.pos; this.lastTrans=null;
			this.msg=why+" for '"+ev+"' in "+this.stateLabel(this.state)+" → rejected";
			this.addLog(this.msg,"#c01818");
			this.emit({type:"stuck",event:ev});
			return false;
		}
		const t=en[0];
		try {
			if (t.action && t.action.trim()) Expr.parseStatements(t.action).forEach(st=>{
				switch (st.k) {
					case "assign": this.vars[st.name]=Expr.evaluate(st.e,this.scope()); break;
					case "inc": { const v=this.scope().get(st.name,st.name); this.vars[st.name]=v+st.d; break; }
					case "expr": Expr.evaluate(st.e,this.scope()); break;
					default: throw new SdlError("timers are not supported here");
				}
			});
		}
		catch(e) { this.restore(snap); this.status="error"; this.msg="action: "+e.message; this.failed=this.pos; this.addLog(this.msg,"#c01818"); this.emit({type:"error"}); return false; }
		this.history.push(snap);
		const from=this.state;
		this.state=t.to;
		this.lastTrans=t.id;
		this.pos++;
		this.status=this.finishStatus();
		let line=this.stateLabel(from)+"  —"+ev+"→  "+this.stateLabel(t.to);
		if (Object.keys(this.vars).length) line+="     "+Object.keys(this.vars).map(k=>k+"="+Expr.toText(this.vars[k])).join(", ");
		this.addLog(line,"#1f4f8a");
		if (en.length>1) this.addLog("  nondeterministic: "+en.length+" transitions enabled, the first one fired","#a05a00");
		if (this.status==="accepted") this.addLog("end of input: ACCEPTED ("+this.stateLabel(this.state)+" is accepting)","#2c6e2c");
		if (this.status==="rejected") this.addLog("end of input: REJECTED ("+this.stateLabel(this.state)+" is not accepting)","#c01818");
		this.emit({type:"fire",trans:t,from,to:t.to,event:ev});
		return true;
	}
	step() {
		const ev=this.next();
		if (ev===null) return false;
		return this.fire(ev);
	}
	// event button: append to the tape and take it
	manual(ev) {
		if (this.isFinal()) return false;
		if (this.pos<this.tokens.length) return false;
		this.tokens.push(ev);
		const ok=this.fire(ev,true);
		if (!ok && this.status!=="stuck") this.tokens.pop();
		return ok;
	}
	back() {
		if (!this.history.length) return false;
		this.restore(this.history.pop());
		this.addLog("  ↶ back to "+this.stateLabel(this.state),typeof THEME!=="undefined"?THEME.textDim:"#888");
		this.emit({type:"back"});
		return true;
	}
}

if (typeof module!=="undefined") module.exports={ FsmSim };
