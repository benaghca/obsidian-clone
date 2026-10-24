// Cancel a pending value before the shared menu closes and blurs its input.
export function menuInputEscape(content:HTMLElement) {
  const cancel=(e:KeyboardEvent)=>{if(e.key==="Escape"&&e.target instanceof HTMLInputElement&&content.contains(e.target))e.target.value=e.target.defaultValue;};
  window.addEventListener("keydown",cancel,true);
  const cleanup=()=>{window.removeEventListener("keydown",cancel,true);observer.disconnect();};
  const observer=new MutationObserver(()=>{if(!content.isConnected)cleanup();});
  observer.observe(document.body,{childList:true});return cleanup;
}
