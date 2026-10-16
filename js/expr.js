// SDL Design Tool - expression / statement / signal text parser (no eval)
//
// Expressions:  numbers, "strings", true/false, identifiers, f(args),
//               + - * / mod rem, = == /= != < > <= >=, and or not (also && || !), ( )
// Statements (task symbol, separated by ; or newline):
//               x := expr   x = expr   x++   x--   set(now+5, T)   reset(T)
// Signals:      NAME(arg1, arg2) to target          (output)
//               NAME(param1, param2)                (input)
// Identifiers and signal names are case-insensitive (like SDL).
"use strict";

class SdlError extends Error {
	constructor(msg) { super(msg); this.name="SdlError"; }
}

const Expr = (()=>{
	function tokenize(src) {
		const toks=[];
		let i=0;
		const s=String(src);
		while (i<s.length) {
			const ch=s[i];
			if (/\s/.test(ch)) { i++; continue; }
			if (/[0-9]/.test(ch) || (ch==="." && /[0-9]/.test(s[i+1]||""))) {
				let j=i; while (j<s.length && /[0-9.]/.test(s[j])) j++;
				toks.push({t:"num",v:parseFloat(s.slice(i,j))}); i=j; continue;
			}
			if (/[A-Za-z_À-ɏ]/.test(ch)) {
				let j=i; while (j<s.length && /[A-Za-z0-9_À-ɏ]/.test(s[j])) j++;
				toks.push({t:"id",v:s.slice(i,j)}); i=j; continue;
			}
			if (ch==='"' || ch==="'") {
				let j=i+1; while (j<s.length && s[j]!==ch) j++;
				if (j>=s.length) throw new SdlError("unterminated string");
				toks.push({t:"str",v:s.slice(i+1,j)}); i=j+1; continue;
			}
			const two=s.slice(i,i+2);
			if ([":=","==","!=","/=","<=",">=","&&","||","++","--","<>"].includes(two)) { toks.push({t:"op",v:two}); i+=2; continue; }
			if ("+-*/%()<>=!,;?".includes(ch)) { toks.push({t:"op",v:ch}); i++; continue; }
			throw new SdlError("unexpected character '"+ch+"'");
		}
		return toks;
	}

	function Parser(toks) {
		let p=0;
		const peek=()=>toks[p];
		const isOp=(v)=>toks[p] && toks[p].t==="op" && toks[p].v===v;
		const isKw=(v)=>toks[p] && toks[p].t==="id" && toks[p].v.toLowerCase()===v;
		const expect=(v)=>{ if (!isOp(v)) throw new SdlError("'"+v+"' expected"+(toks[p]?" near '"+toks[p].v+"'":"")); p++; };
		function expr() { return or(); }
		function or() {
			let l=and();
			while (isOp("||")||isKw("or")) { p++; l={k:"bin",op:"or",l,r:and()}; }
			return l;
		}
		function and() {
			let l=not();
			while (isOp("&&")||isKw("and")) { p++; l={k:"bin",op:"and",l,r:not()}; }
			return l;
		}
		function not() {
			if (isOp("!")||isKw("not")) { p++; return {k:"un",op:"not",e:not()}; }
			return cmp();
		}
		function cmp() {
			let l=add();
			for (;;) {
				const t=peek();
				if (t && t.t==="op" && ["=","==","!=","/=","<>","<",">","<=",">="].includes(t.v)) {
					p++;
					let op=t.v; if (op==="==") op="="; if (op==="/="||op==="<>") op="!=";
					l={k:"bin",op,l,r:add()};
				} else return l;
			}
		}
		function add() {
			let l=mul();
			while (isOp("+")||isOp("-")) { const op=toks[p++].v; l={k:"bin",op,l,r:mul()}; }
			return l;
		}
		function mul() {
			let l=unary();
			while (isOp("*")||isOp("/")||isOp("%")||isKw("mod")||isKw("rem")) {
				let op=toks[p++].v.toLowerCase(); if (op==="%") op="mod";
				l={k:"bin",op,l,r:unary()};
			}
			return l;
		}
		function unary() {
			if (isOp("-")) { p++; return {k:"un",op:"neg",e:unary()}; }
			if (isOp("+")) { p++; return unary(); }
			return primary();
		}
		function primary() {
			const t=peek();
			if (!t) throw new SdlError("unexpected end of expression");
			if (t.t==="num") { p++; return {k:"num",v:t.v}; }
			if (t.t==="str") { p++; return {k:"str",v:t.v}; }
			if (isOp("(")) { p++; const e=expr(); expect(")"); return e; }
			if (t.t==="id") {
				p++;
				const low=t.v.toLowerCase();
				if (low==="true") return {k:"bool",v:true};
				if (low==="false") return {k:"bool",v:false};
				if (isOp("(")) {
					p++;
					const args=[];
					if (!isOp(")")) { args.push(expr()); while (isOp(",")) { p++; args.push(expr()); } }
					expect(")");
					return {k:"call",name:low,args};
				}
				return {k:"id",name:low,raw:t.v};
			}
			throw new SdlError("unexpected '"+t.v+"'");
		}
		return { expr, peek, isOp, isKw, expect, pos:()=>p, done:()=>p>=toks.length, next:()=>toks[p++] };
	}

	function parse(src) {
		let s=String(src).trim().replace(/\?\s*$/,"");      // "N==M ?" -> "N==M"
		if (s==="") throw new SdlError("empty expression");
		const P=Parser(tokenize(s));
		const e=P.expr();
		if (!P.done()) throw new SdlError("unexpected '"+P.peek().v+"'");
		return e;
	}

	// scope: { get(name) -> value, call(name,args) -> value }
	function evaluate(e,scope) {
		switch (e.k) {
			case "num": case "str": case "bool": return e.v;
			case "id": return scope.get(e.name,e.raw);
			case "un": {
				const v=evaluate(e.e,scope);
				if (e.op==="neg") return -num(v);
				return !truthy(v);
			}
			case "bin": {
				if (e.op==="and") return truthy(evaluate(e.l,scope)) && truthy(evaluate(e.r,scope));
				if (e.op==="or") return truthy(evaluate(e.l,scope)) || truthy(evaluate(e.r,scope));
				const a=evaluate(e.l,scope), b=evaluate(e.r,scope);
				switch (e.op) {
					case "+": return (typeof a==="string"||typeof b==="string") ? String(a)+String(b) : num(a)+num(b);
					case "-": return num(a)-num(b);
					case "*": return num(a)*num(b);
					case "/": if (num(b)===0) throw new SdlError("division by zero"); return Number.isInteger(a)&&Number.isInteger(b)?Math.trunc(a/b):a/b;
					case "mod": { const m=num(b); if (m===0) throw new SdlError("mod by zero"); return ((num(a)%m)+m)%m; }
					case "rem": { const m=num(b); if (m===0) throw new SdlError("rem by zero"); return num(a)%m; }
					case "=": return equal(a,b);
					case "!=": return !equal(a,b);
					case "<": return a<b;
					case ">": return a>b;
					case "<=": return a<=b;
					case ">=": return a>=b;
				}
				throw new SdlError("bad operator "+e.op);
			}
			case "call": return scope.call(e.name,e.args.map(a=>evaluate(a,scope)));
		}
		throw new SdlError("bad expression");
	}
	function num(v) {
		if (typeof v==="number") return v;
		if (typeof v==="boolean") return v?1:0;
		throw new SdlError("number expected, got '"+v+"'");
	}
	function truthy(v) { return v===true || (typeof v==="number" && v!==0) || (typeof v==="string" && v!==""); }
	function equal(a,b) {
		if (typeof a==="string" && typeof b==="string") return a.toLowerCase()===b.toLowerCase();
		return a===b;
	}

	// split "a := 1; b++\n set(now+1, T)" into statements (not inside parentheses/strings)
	function splitTop(s,seps) {
		const out=[]; let depth=0, cur="", q=null;
		for (const ch of String(s)) {
			if (q) { cur+=ch; if (ch===q) q=null; continue; }
			if (ch==='"'||ch==="'") { q=ch; cur+=ch; continue; }
			if (ch==="(") depth++;
			if (ch===")") depth--;
			if (depth===0 && seps.includes(ch)) { out.push(cur); cur=""; continue; }
			cur+=ch;
		}
		out.push(cur);
		return out.map(x=>x.trim()).filter(x=>x!=="");
	}

	function parseStatements(src) {
		return splitTop(src,";\n").map(st=>{
			let m;
			if ((m=st.match(/^([A-Za-z_]\w*)\s*(\+\+|--)$/))) return {k:"inc",name:m[1].toLowerCase(),d:m[2]==="++"?1:-1};
			if ((m=st.match(/^([A-Za-z_]\w*)\s*(:=|=)(?!=)\s*([\s\S]+)$/))) return {k:"assign",name:m[1].toLowerCase(),e:parse(m[3])};
			if ((m=st.match(/^set\s*\(([\s\S]*)\)$/i))) {
				const a=splitTop(m[1],",");
				if (a.length!==2 || !/^[A-Za-z_]\w*$/.test(a[1])) throw new SdlError("usage: set(now+5, T)");
				return {k:"set",e:parse(a[0]),timer:a[1]};
			}
			if ((m=st.match(/^reset\s*\(\s*([A-Za-z_]\w*)\s*\)$/i))) return {k:"reset",timer:m[1]};
			// any other expression, e.g. a function call
			return {k:"expr",e:parse(st)};
		});
	}

	// "INIT(sender, N) to offspring"
	function parseOutput(src) {
		const out=[];
		splitTop(src,";").forEach(part=>{
			const m=part.trim().match(/^([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\))?\s*(?:\bto\s+([\s\S]+))?$/i);
			if (!m) throw new SdlError("signal expected: NAME(args) to target");
			const args=m[2]!==undefined ? splitTop(m[2],",").map(parse) : [];
			out.push({name:m[1],args,to:m[3]?parse(m[3]):null});
		});
		if (!out.length) throw new SdlError("signal expected");
		return out;
	}

	// "GUESS(m)"  or "A, B" (list of signals, e.g. in a save symbol)
	function parseInput(src) {
		const s=String(src).trim();
		if (s==="*") return [{name:"*",params:[]}];
		return splitTop(s,",;\n").map(part=>{
			const m=part.match(/^([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\))?$/);
			if (!m) throw new SdlError("signal expected: NAME(param, ...)");
			const params=m[2]!==undefined ? splitTop(m[2],",") : [];
			params.forEach(p=>{ if (!/^[A-Za-z_]\w*$/.test(p)) throw new SdlError("parameter must be a variable name: "+p); });
			return {name:m[1],params:params.map(p=>p.toLowerCase())};
		});
	}

	// "GAME" or "GAME(args)"
	function parseCreate(src) {
		const m=String(src).trim().match(/^([A-Za-z_]\w*)\s*(?:\(([\s\S]*)\))?$/);
		if (!m) throw new SdlError("process name expected");
		return {name:m[1],args:m[2]!==undefined?splitTop(m[2],",").map(parse):[]};
	}

	// "dcl n, m;"  or  "n, m := 5, s := 'abc'"
	function parseDcl(src) {
		const s=String(src).replace(/^\s*dcl\b/i,"");
		return splitTop(s,",;\n").map(d=>{
			const m=d.match(/^([A-Za-z_]\w*)(?:\s+\w+)?\s*(?::=\s*([\s\S]+))?$/);
			if (!m) throw new SdlError("bad declaration: "+d);
			return {name:m[1].toLowerCase(),init:m[2]?parse(m[2]):null};
		});
	}

	function toText(v) {
		if (typeof v==="string") return v;
		if (typeof v==="number") return Number.isInteger(v)?String(v):String(Math.round(v*1000)/1000);
		return String(v);
	}

	return { tokenize, parse, evaluate, truthy, equal, parseStatements, parseOutput, parseInput, parseCreate, parseDcl, splitTop, toText };
})();

if (typeof module!=="undefined") module.exports={ Expr, SdlError };
