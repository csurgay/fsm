// FSM Tool - main: workspace, menus, startup
// 2026 Peter Csurgay
"use strict";

initCanvas("mycanvas");
installInput();
var workspace=WM.init("FSM Design Tool – finite state machines – 2026 Peter Csurgay");

var simWindow=new SimWindow(new Rect(820,8,440,420));
workspace.push(simWindow);
var propsWindow=new PropsWindow(new Rect(820,436,440,260));
workspace.push(propsWindow);
FsmCtl.win=simWindow;

/* ---------------- several machines, one diagram window each ---------------- */
function diagramWindows() { return Fsm.docs.map(d=>d.win).filter(Boolean); }
// make doc the machine the Simulation / Properties windows work on
function setActiveDoc(doc) {
	if (!doc || Fsm.doc===doc) return;
	WM.commitEdit();                      // a pending edit belongs to the previous machine
	Fsm.doc=doc;
	simWindow.inputField.value=doc.input||"";
	WM.lastView=doc.view;
	Fsm.persist();
	invalidate();
}
function openMachine(f,input,opts={}) {
	WM.commitEdit();
	if (input===undefined) input=f.input||"";
	delete f.input;
	const doc=Fsm.newDoc(f,input);
	FsmCtl.attach(doc);
	// cascade the new window inside the diagram area
	const ca=workspace.clientArea, R=sideWidth();
	const n=diagramWindows().length;
	const w=new DiagramWindow(new Rect(8+(n%8)*28,8+(n%8)*28,Math.max(300,ca.w-R-24-120),Math.max(200,ca.h-16-120)),doc);
	if (opts.rect) { w.moveTo(opts.rect.x,opts.rect.y); w.setSize(opts.rect.w,opts.rect.h); }
	w.onActivate=(d)=>setActiveDoc(d);
	w.beforeClose=()=>{ closeMachine(doc); return true; };
	w.view.onSelect=()=>invalidate();
	workspace.push(w);
	w.activate();
	Fsm.persist();
	setTimeout(()=>w.view.fit(),0);
	return doc;
}
function closeMachine(doc) {
	FsmCtl.pause(doc);
	if (WM.lastView===doc.view) WM.lastView=null;
	Fsm.closeDoc(doc);
	doc.win=null;
	// the previous window (top of the stack) becomes active
	const rest=diagramWindows();
	const top=workspace.clientArea.children.filter(ch=>rest.includes(ch)).pop();
	if (top) setTimeout(()=>top.activate(),0);
	else setTimeout(()=>{ if (!Fsm.docs.length) newMachine(); },0);
}
function newMachine() { openMachine({format:"fsm-tool/1",name:"Untitled",vars:"",states:[],transitions:[]},""); }
function activeDiagram() { return Fsm.doc ? Fsm.doc.win : null; }

/* ---------------- menus ---------------- */
var mainmenu=new MenuBar();
workspace.addMenu(mainmenu);

var filemenu=mainmenu.addMenu("File");
filemenu.build=(m)=>{
	m.add("New machine",()=>newMachine(),{key:"Ctrl+M"});
	m.add("Open…",()=>openFile(),{key:"Ctrl+O"});
	m.add("Save",()=>saveFile(),{key:"Ctrl+S",enabled:()=>!!Fsm.doc});
	m.add("Close machine",()=>{ const w=activeDiagram(); if (w) w.close(); },{enabled:()=>!!Fsm.doc});
	m.add("-");
	if (!Examples.loaded) m.add("Examples: loading…",null,{enabled:()=>false});
	else if (!Examples.list.length) m.add("Examples: "+Examples.error,null,{enabled:()=>false});
	else Examples.list.forEach(ex=>m.add("Example: "+ex.name,()=>{ const e=Examples.make(ex); openMachine(e.fsm,e.input); }));
	m.add("Reload examples",()=>{ Examples.loaded=false; Examples.load().then(()=>invalidate()); });
};

var editmenu=mainmenu.addMenu("Edit");
editmenu.add("Undo",()=>Fsm.undo(),{key:"Ctrl+Z",enabled:()=>Fsm.undoStack.length>0});
editmenu.add("Redo",()=>Fsm.redo(),{key:"Ctrl+Y",enabled:()=>Fsm.redoStack.length>0});
editmenu.add("-");
editmenu.add("New state",()=>{ const v=FsmCtl.view; if (!v) return; const p=v.toDiagram(v.ax+v.w/2,v.ay+v.h/2); const s=v.doEdit("state",()=>Fsm.addState(p.x,p.y)); if (s) { v.select({kind:"state",id:s.id}); v.editLabel(s); } });
const selState=()=>!!(FsmCtl.view&&FsmCtl.view.sel&&FsmCtl.view.sel.kind==="state");
editmenu.add("Edit label",()=>FsmCtl.view.editLabel(FsmCtl.view.selected()),{key:"F2",enabled:()=>!!(FsmCtl.view&&FsmCtl.view.selected())});
editmenu.add("Accepting state",()=>FsmCtl.view.toggleAccepting(FsmCtl.view.sel.id),{key:"A",enabled:selState});
editmenu.add("Initial state",()=>FsmCtl.view.setInitial(FsmCtl.view.sel.id),{key:"I",enabled:selState});
editmenu.add("Delete",()=>FsmCtl.view.deleteSelected(),{key:"Del",enabled:()=>!!(FsmCtl.view&&FsmCtl.view.selected())});
editmenu.add("-");
editmenu.add("Fit diagram to window",()=>{ if (FsmCtl.view) FsmCtl.view.fit(); },{key:"0"});

var simmenu=mainmenu.addMenu("Simulation");
simmenu.add("Reset",()=>FsmCtl.reset(),{key:"F9"});
simmenu.add("Step",()=>FsmCtl.step(),{key:"F10"});
simmenu.add("Back",()=>FsmCtl.back(),{key:"Shift+F10"});
simmenu.add("Run / Pause",()=>FsmCtl.run(),{key:"F8",checked:()=>FsmCtl.running});
simmenu.add("Slower",()=>FsmCtl.slower());
simmenu.add("Faster",()=>FsmCtl.faster());
simmenu.add("-");
simmenu.add("Random simulation",()=>RandomSim.start(),{checked:()=>RandomSim.on});
simmenu.add("-");
simmenu.add("Unhandled event rejects the input (automaton)",()=>{ if (FsmCtl.sim) FsmCtl.sim.ignoreUnhandled=false; },{checked:()=>!!FsmCtl.sim && !FsmCtl.sim.ignoreUnhandled});
simmenu.add("Unhandled event is ignored (reactive system)",()=>{ if (FsmCtl.sim) FsmCtl.sim.ignoreUnhandled=true; },{checked:()=>!!FsmCtl.sim && FsmCtl.sim.ignoreUnhandled});

var windowmenu=mainmenu.addMenu("Window");
windowmenu.build=(m)=>{
	m.add("Default arrangement",()=>arrangeDefault());
	m.add("Cascade diagrams",()=>cascade());
	m.add("Tile diagrams",()=>tile());
	m.add("-");
	diagramWindows().forEach(w=>m.add(w.title(),()=>w.show(),{checked:()=>w.doc===Fsm.doc}));
	m.add("-");
	[simWindow,propsWindow].forEach(w=>m.add(typeof w.title==="function"?w.title():w.title,()=>w.show(),{checked:()=>w.visible}));
};

var helpmenu=mainmenu.addMenu("Help");
helpmenu.add("Usage…",()=>WM.message("Usage",[
	"DRAWING",
	"  double click on the background: new state",
	"  drag inside a state: move it",
	"  drag from the rim of a state (or Shift+drag): new transition",
	"     drop on a state / on itself (loop) / on the background (new state)",
	"  drag a transition or its label: bend it (loops: turn around)",
	"  drag the small initial arrow: turn it, or drop it on another state",
	"  double click / F2: edit label,  A: accepting,  I: initial,  Del: delete",
	"  wheel: scroll,  Ctrl+wheel: zoom,  drag background: pan,  0: fit",
	"",
	"TRANSITION LABEL:   event [guard] / action",
	"  coin          a, b          button [credit >= 200] / credit := credit - 200",
	"  variables are declared in Properties (nothing selected):  credit := 0",
	"",
	"SEVERAL MACHINES",
	"  New / Open / Example opens a new diagram window; click a diagram window",
	"  to make it active – Simulation and Properties always show the active one",
	"  examples: every *.fsm.json in the examples/ folder (saved with File / Save)",
	"",
	"SIMULATION",
	"  type the input (coin push push  or  0110) and press Enter",
	"  F10 step, Shift+F10 back, F8 run, F9 reset",
	"  with an empty input box the event buttons fire events directly",
	"  Simulation / Random simulation: every open machine takes randomly chosen",
	"     possible events (guards are checked); a dead end restarts it",
].join("\n"),600));
helpmenu.add("About…",()=>WM.message("About","FSM Design Tool\nFinite state machine editor and simulator\non the canvas window system of the SDL tool.\n\n2026 Peter Csurgay"));

/* ---------------- keys ---------------- */
WM.addKey("z",()=>Fsm.undo(),true);
WM.addKey("y",()=>Fsm.redo(),true);
WM.addKey("z",()=>Fsm.redo(),true,true);
WM.addKey("s",()=>saveFile(),true);
WM.addKey("o",()=>openFile(),true);
WM.addKey("m",()=>newMachine(),true);
WM.addKey("F8",()=>FsmCtl.run());
WM.addKey("F9",()=>FsmCtl.reset());
WM.addKey("F10",()=>FsmCtl.step());
WM.addKey("F10",()=>FsmCtl.back(),false,true);

/* ---------------- files ---------------- */
function saveFile() {
	WM.commitEdit();
	if (!Fsm.doc) return;
	const f=Object.assign({},Fsm.fsm,{input:Fsm.doc.input||""});
	download((Fsm.fsm.name||"machine").replace(/\W+/g,"_")+".fsm.json",JSON.stringify(f,null,1));
}
function openFile() {
	const inp=document.createElement("input");
	inp.type="file"; inp.accept=".json,application/json"; inp.multiple=true;
	inp.onchange=()=>{
		[...inp.files].forEach(file=>file.text().then(t=>{
			try { openMachine(Fsm.fromJSON(t)); }
			catch(e) { WM.message("Open","Cannot open "+file.name+":\n"+e.message); }
		}));
	};
	inp.click();
}
function download(fname,text) {
	const a=document.createElement("a");
	a.href=URL.createObjectURL(new Blob([text],{type:"application/json;charset=utf-8"}));
	a.download=fname;
	document.body.appendChild(a); a.click();
	setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
}

/* ---------------- window arrangement ---------------- */
function sideWidth() { const W=workspace.clientArea.w; return Math.max(360,Math.min(480,Math.round(W*0.32))); }
function cascade() {
	const ca=workspace.clientArea, R=sideWidth();
	const ws=workspace.clientArea.children.filter(ch=>ch instanceof DiagramWindow);   // in stacking order
	const k=Math.min(ws.length-1,6), dx=28;
	ws.forEach((w,i)=>{
		const j=Math.min(i,k);
		w.show(); w.moveTo(8+j*dx,8+j*dx); w.setSize(ca.w-R-24-k*dx,ca.h-16-k*dx);
	});
	const a=activeDiagram(); if (a) a.activate();
}
// all diagram windows side by side (and in rows if needed), each one fitted to its window
function tile() {
	WM.commitEdit();
	const ws=diagramWindows(); if (!ws.length) return;
	const ca=workspace.clientArea, R=sideWidth(), gap=6;
	const AW=ca.w-R-24, AH=ca.h-16, n=ws.length;
	// the grid whose cells are the largest (as close to square as possible)
	let best=null;
	for (let cols=1;cols<=n;cols++) {
		const rows=Math.ceil(n/cols);
		const cw=(AW-(cols-1)*gap)/cols, ch=(AH-(rows-1)*gap)/rows;
		const score=Math.min(cw,ch);
		if (!best || score>best.score) best={cols,rows,score};
	}
	const {cols,rows}=best;
	const cw=Math.floor((AW-(cols-1)*gap)/cols), ch=Math.floor((AH-(rows-1)*gap)/rows);
	ws.forEach((w,i)=>{
		const r=Math.floor(i/cols), k=i%cols;
		// the last row is spread over the full width when it is not full
		const inRow=r===rows-1 ? n-r*cols : cols;
		const rw=Math.floor((AW-(inRow-1)*gap)/inRow);
		w.show(); w.moveTo(8+k*(rw+gap),8+r*(ch+gap)); w.setSize(rw,ch);
	});
	const a=activeDiagram(); if (a) a.activate();
	setTimeout(()=>{ ws.forEach(w=>w.view.fit()); invalidate(); },0);
}
function arrangeDefault() {
	const ca=workspace.clientArea, W=ca.w, H=ca.h, R=sideWidth();
	simWindow.show(); simWindow.moveTo(W-R-8,8); simWindow.setSize(R,Math.round(H*0.6));
	propsWindow.show(); propsWindow.moveTo(W-R-8,simWindow.h+16); propsWindow.setSize(R,H-simWindow.h-24);
	cascade();
}

/* ---------------- start ---------------- */
Fsm.listeners.push((what)=>{
	const d=Fsm.doc; if (!d || !d.sim) return;
	const s=d.sim;
	// the active state was deleted, or a new machine: start again
	if (["load","undo","redo","error"].includes(what) || (s.state && !Fsm.state(s.state)) || (!s.state && Fsm.fsm.initial)) s.reset(d.input);
	invalidate();
});
(function start() {
	arrangeDefault();
	const saved=Fsm.restore();
	saved.docs.forEach(d=>{ try { openMachine(d.fsm,d.input||""); } catch(e) { console.warn(e); } });
	const want=Fsm.docs[saved.active];
	if (want && want.win) want.win.activate();
	if (saved.docs.length) cascade();
	Examples.load().then(()=>{
		// first start: the first example, or an empty machine
		if (!Fsm.docs.length) {
			if (Examples.list.length) { const e=Examples.make(Examples.list[0]); openMachine(e.fsm,e.input); }
			else newMachine();
		}
		invalidate();
	});
})();
