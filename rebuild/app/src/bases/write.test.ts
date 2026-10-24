// @ts-expect-error Shared headless observation fixtures are plain JavaScript.
import {bases} from "../../../round30-shots/fixtures.mjs";
import {expect,it} from "vitest";
import {readYaml} from "./yaml";
import {writeView} from "./write";
it("replaces only order/sort, keeping global filters, quotes, comments and other views",()=>{
 const source=`# head\nfilters: 'status != "done"'\nviews:\n  - type: table\n    name: "Quoted"\n    order:\n      - file.name\n      - status\n    # keep before sort\n    sort:\n      - property: status\n        direction: ASC\n    # keep after sort\n    limit: 3\n  - type: table\n    name: Other\n    order:\n      - due\n# tail\n`;
 const sort=writeView(source,"sort",[{property:"priority",direction:"DESC"}]);
 expect(sort).toBe(source.replace('property: status\n        direction: ASC','property: priority\n        direction: DESC'));
 const order=writeView(source,"order",["file.name","due"]);
 expect(order).toBe(source.replace('      - status\n','      - due\n'));
 expect(writeView(source,"order",[],1)).toBe(source.replace('    order:\n      - due\n','    order: []\n'));
 expect(readYaml(sort).filters).toBe('status != "done"');
});
it("inserts missing blocks in the view, preserving final comments and CRLF",()=>{
 const s='views:\r\n  - type: table\r\n    name: View\r\n# final\r\n';
 expect(writeView(s,"sort",[{property:"note.a b",direction:"ASC"}])).toBe(s.replace('# final','    sort:\r\n      - property: note.a b\r\n        direction: ASC\r\n# final'));
 expect(writeView('views:\n  - type: table',"order",["file.name"])).toBe('views:\n  - type: table\n    order:\n      - file.name\n');
});
it("supports empty/default views, empty lists and a first inline view key",()=>{
 expect(readYaml(writeView('',"order",[]))).toMatchObject({views:[{type:'table',name:'View',order:[]}]});
 expect(writeView('views:\n  - order:\n      - status\n    name: V\n',"order",["file.name"])).toBe('views:\n  - order:\n      - file.name\n    name: V\n');
 expect(()=>writeView('views:\n  - type: table\n',"order",[],1)).toThrow();
});

it("round-trips every supported round 30 fixture and canonicalizes only the edited flow list",()=>{
 for(const [name,source] of Object.entries(bases)) {
  if(name === "Invalid.base")continue;
  const before=readYaml(source as string);
  const after=readYaml(writeView(source as string,"order",["file.name","note.status"]));
  for(const key of ["filters","formulas","properties"])expect(after[key]).toEqual(before[key]);
 }
 const s=`# comment\nfilters: 'status != "done"'\nextra: [a, "b, c"]\nviews:\n  - name: "Quoted"\n    order: [file.name,status] # edited\n    limit: 3\n`;
 expect(writeView(s,"order",["due"])).toBe(s.replace('    order: [file.name,status] # edited\n','    order:\n      - due\n'));
});
