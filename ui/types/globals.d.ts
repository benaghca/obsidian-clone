// What Cinder's own scripts see from outside them: the vendored libraries, the ui/*.js modules
// (loaded as window.Cinder* globals before app.js), and the desktop window's bridge.
declare var CinderEditor: any;
declare var CinderThemes: any;
declare var CinderTemplater: any;
declare var CinderTasks: any;
declare var CinderBases: any;
declare var CinderCanvas: any;
declare var CinderDraw: any;
declare var CinderDrawRender: any;
declare var CinderGraph: any;
declare var CinderImages: any;
declare var CinderProps: any;
declare var CinderDiff: any;
declare var CinderRelated: any;
declare var CinderSearch: any;
declare var CinderYaml: any;
declare var katex: any;
declare var marked: any;
declare var DOMPurify: any;
declare var MathJax: any;
interface Window { ipc?: { postMessage(msg: string): void }; [key: string]: any }
declare var CinderSketch: any;
declare var module: any;
declare function require(id: string): any;
// In this UI every event comes from an element, so its target is treated as one.
interface EventTarget { closest(selector: string): any; matches(selector: string): boolean; dataset: DOMStringMap; classList: DOMTokenList; value: any; checked: boolean; tagName: string; type: string; isContentEditable: boolean; getAttribute(name: string): string | null }
// Elements looked up by selector are the app's own markup, so they're typed loosely (as $() is).
interface ParentNode { querySelector(selectors: string): any; querySelectorAll(selectors: string): NodeListOf<any> }
interface Event { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; button: number; pointerId: number; clientX: number; clientY: number }
