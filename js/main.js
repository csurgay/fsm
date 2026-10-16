// FSM Tool - main: workspace, menus, startup
// 2026 Peter Csurgay
"use strict";

initCanvas("mycanvas");
installInput();
var workspace=WM.init("FSM Design Tool – finite state machines – 2026 Peter Csurgay");

var diagramWindow=new DiagramWindow(new Rect(8,8,800,600));
workspace.push(diagramWindow);
var simWindow=new SimWindow(new Rect(820,8,440,420));
workspace.push(simWindow);
var propsWindow=new PropsWindow(new Rect(820,436,440,260));
workspace.push(propsWindow);
FsmCtl.view=diagramWindow.view;
FsmCtl.win=simWindow;
FsmCtl.view.highlight=()=>FsmCtl.highlight();
FsmCtl.view.onSelect=()=>invalidate();

/* ---------------- menus ---------------- */
var mainmenu=new MenuBar();
workspace.addMenu(mainmenu);

var filemenu=mainmenu.addMenu("File");
filemenu.add("New machine",()=>WM.confirm("New machine","Discard the current machine and start a new one?",()=>loadMachine({format:"fsm-tool/1",name:"Untitled",vars:"",states:[],transitions:[]},"")));
filemenu.add("Open…",()=>openFile(),{key:"Ctrl+O"});
filemenu.add("Save",()=>saveFile(),{key:"Ctrl+S"});
filemenu.add("-");
FSM_EXAMPLES.forEach(ex=>filemenu.add("Example: "+ex.name,()=>loadMachine(ex.make(),ex.input)));

var editmenu=mainmenu.addMenu("Edit");
editmenu.add("Undo",()=>Fsm.undo(),{key:"Ctrl+Z",enabled:()=>Fsm.undoStack.length>0});
editmenu.add("Redo",()=>Fsm.redo(),{key:"Ctrl+Y",enabled:()=>Fsm.redoStack.length>0});
editmenu.add("-");
editmenu.add("New state",()=>{ const v=FsmCtl.view; const p=v.toDiagram(v.ax+v.w/2,v.ay+v.h/2); const s=v.doEdit("state",()=>Fsm.addState(p.x,p.y)); if (s) { v.select({kind:"state",id:s.id}); v.editLabel(s); } });
editmenu.add("Edit label",()=>FsmCtl.view.editLabel(FsmCtl.view.selected()),{key:"F2",enabled:()=>!!FsmCtl.view.selected()});
editmenu.add("Accepting state",()=>FsmCtl.view.toggleAccepting(FsmCtl.view.sel.id),{key:"A",enabled:()=>!!(FsmCtl.view.sel&&FsmCtl.view.sel.kind==="state")});
editmenu.add("Initial state",()=>FsmCtl.view.setInitial(FsmCtl.view.sel.id),{key:"I",enabled:()=>!!(FsmCtl.view.sel&&FsmCtl.view.sel.kind==="state")});
editmenu.add("Delete",()=>FsmCtl.view.deleteSelected(),{key:"Del",enabled:()=>!!FsmCtl.view.selected()});
editmenu.add("-");
editmenu.add("Fit diagram to window",()=>FsmCtl.view.fit(),{key:"0"});

var simmenu=mainmenu.addMenu("Simulation");
simmenu.add("Reset",()=>FsmCtl.reset(),{key:"F9"});
simmenu.add("Step",()=>FsmCtl.step(),{key:"F10"});
simmenu.add("Back",()=>FsmCtl.back(),{key:"Shift+F10"});
simmenu.add("Run / Pause",()=>FsmCtl.run(),{key:"F8",checked:()=>FsmCtl.running});
simmenu.add("Slower",()=>FsmCtl.slower());
simmenu.add("Faster",()=>FsmCtl.faster());
simmenu.add("-");
simmenu.add("Unhandled event rejects the input (automaton)",()=>{ FsmCtl.sim.ignoreUnhandled=false; },{checked:()=>!FsmCtl.sim.ignoreUnhandled});
simmenu.add("Unhandled event is ignored (reactive system)",()=>{ FsmCtl.sim.ignoreUnhandled=true; },{checked:()=>FsmCtl.sim.ignoreUnhandled});

var windowmenu=mainmenu.addMenu("Window");
windowmenu.build=(m)=>{
	m.add("Default arrangement",()=>arrangeDefault());
	m.add("-");
	[diagramWindow,simWindow,propsWindow].forEach(w=>m.add(typeof w.title==="function"?w.title():w.title,()=>w.show(),{checked:()=>w.visible}));
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
	"SIMULATION",
	"  type the input (coin push push  or  0110) and press Enter",
	"  F10 step, Shift+F10 back, F8 run, F9 reset",
	"  with an empty input box the event buttons fire events directly",
].join("\n"),560));
helpmenu.add("About…",()=>WM.message("About","FSM Design Tool\nFinite state machine editor and simulator\non the canvas window system of the SDL tool.\n\n2026 Peter Csurgay"));

/* ---------------- keys ---------------- */
WM.addKey("z",()=>Fsm.undo(),true);
WM.addKey("y",()=>Fsm.redo(),true);
WM.addKey("z",()=>Fsm.redo(),true,true);
WM.addKey("s",()=>saveFile(),true);
WM.addKey("o",()=>openFile(),true);
WM.addKey("F8",()=>FsmCtl.run());
WM.addKey("F9",()=>FsmCtl.reset());
WM.addKey("F10",()=>FsmCtl.step());
WM.addKey("F10",()=>FsmCtl.back(),false,true);

/* ---------------- files ---------------- */
function loadMachine(f,input) {
	Fsm.load(f);
	FsmCtl.view.select(null);
	simWindow.inputField.value=input||"";
	FsmCtl.load(input||"");
	setTimeout(()=>FsmCtl.view.fit(),0);
}
function saveFile() {
	WM.commitEdit();
	const f=Object.assign({},Fsm.fsm,{input:simWindow.inputField.value});
	download((Fsm.fsm.name||"machine").replace(/\W+/g,"_")+".fsm.json",JSON.stringify(f,null,1));
}
function openFile() {
	const inp=document.createElement("input");
	inp.type="file"; inp.accept=".json,application/json";
	inp.onchange=()=>{
		const file=inp.files[0]; if (!file) return;
		file.text().then(t=>{
			try { const f=Fsm.fromJSON(t); loadMachine(f,f.input||""); }
			catch(e) { WM.message("Open","Cannot open "+file.name+":\n"+e.message); }
		});
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
function arrangeDefault() {
	const ca=workspace.clientArea, W=ca.w, H=ca.h;
	const R=Math.max(360,Math.min(480,Math.round(W*0.32)));
	diagramWindow.show(); diagramWindow.moveTo(8,8); diagramWindow.setSize(W-R-24,H-16);
	simWindow.show(); simWindow.moveTo(W-R-8,8); simWindow.setSize(R,Math.round(H*0.6));
	propsWindow.show(); propsWindow.moveTo(W-R-8,simWindow.h+16); propsWindow.setSize(R,H-simWindow.h-24);
	diagramWindow.activate();
}

/* ---------------- start ---------------- */
Fsm.listeners.push((what)=>{
	const s=FsmCtl.sim;
	// the active state was deleted, or a new machine: start again
	if (["load","undo","redo","error"].includes(what) || (s.state && !Fsm.state(s.state)) || (!s.state && Fsm.fsm.initial)) s.reset(simWindow.inputField.value);
	invalidate();
});
FsmCtl.init();
(function start() {
	let f=null, input=FSM_EXAMPLES[0].input;
	try { const s=localStorage.getItem("fsm-tool-project"); if (s) { f=Fsm.fromJSON(s); input=localStorage.getItem("fsm-tool-input")||""; } } catch(e) { f=null; }
	arrangeDefault();
	loadMachine(f||FSM_EXAMPLES[0].make(),input);
	WM.allEvents.push(()=>{ try { localStorage.setItem("fsm-tool-input",simWindow.inputField.value); } catch(e) {} });
})();
