import { h } from "../shell/dom";
/** Small instant notices shared by Bases actions, stacked in arrival order. */
export function baseNotice(text:string) {
  let stack=document.querySelector<HTMLElement>(".bases-notices");
  if(!stack){stack=h("div",{class:"bases-notices"});document.body.append(stack);}
  const notice=h("div",{class:"bases-copy-notice",role:"status"},text);stack.append(notice);
  setTimeout(()=>{notice.remove();if(!stack.childElementCount)stack.remove();},2500);
}
