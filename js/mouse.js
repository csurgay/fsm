// SDL Design Tool - mouse / keyboard input -> WM
// Events are handled immediately (no polling queue), drawing happens in the next frame.
// Pointer capture keeps a drag alive even when the mouse leaves the canvas.
"use strict";

function getMousePos(pcanvas,evt) {
	const rect=pcanvas.getBoundingClientRect();
	return { x:Math.floor(evt.clientX-rect.left), y:Math.floor(evt.clientY-rect.top) };
}
function mouseEvent(type,evt) {
	const pos=getMousePos(canvas,evt);
	WM.handle(new WEvent(pos.x,pos.y,type,evt));
}
function installInput() {
	canvas.addEventListener("pointerdown",(evt)=>{
		if (evt.button===2) return;                  // right button: contextmenu event
		try { canvas.setPointerCapture(evt.pointerId); } catch(e) {}
		mouseEvent(e_down,evt);
	});
	canvas.addEventListener("pointermove",(evt)=>mouseEvent(e_move,evt));
	canvas.addEventListener("pointerup",(evt)=>{
		if (evt.button===2) return;
		try { canvas.releasePointerCapture(evt.pointerId); } catch(e) {}
		mouseEvent(e_up,evt);
	});
	canvas.addEventListener("dblclick",(evt)=>mouseEvent(e_dbl,evt));
	canvas.addEventListener("contextmenu",(evt)=>{ evt.preventDefault(); mouseEvent(e_ctx,evt); });
	canvas.addEventListener("wheel",(evt)=>{ evt.preventDefault(); mouseEvent(e_wheel,evt); },{passive:false});
	window.addEventListener("keydown",(evt)=>{
		if (evt.target && evt.target.tagName==="TEXTAREA") return;
		if (WM.handleKey(evt)) evt.preventDefault();
	});
	window.addEventListener("resize",()=>{
		WM.commitEdit();
		fitCanvas();
		WM.resize(canvas.clientWidth,canvas.clientHeight);
	});
}
