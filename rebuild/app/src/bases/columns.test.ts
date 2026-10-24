import {expect,it} from "vitest";
import {writeView} from "./write";
import {baseModel} from "./model";
import {reordered} from "./drag";
const source='# before\nfilters: \'status != "done"\'\nviews:\n  - type: table\n    name: "Quoted"\n    order: [file.name, due, status]\n    # after order\n  - type: table\n    name: Other\n# tail\n';
it("inserts, updates and removes only columnSize, preserving other views, quotes, comments and CRLF",()=>{
 const block='    columnSize:\n      note.due: 196\n      note.status: 40\n';
 const sized=writeView(source,'columnSize',{'note.due':196,'note.status':40});
 expect(sized).toBe(source.replace('    # after order',block+'    # after order'));
 expect(writeView(sized,'columnSize',{'note.status':40})).toBe(sized.replace('      note.due: 196\n',''));
 expect(writeView(sized,'columnSize',undefined)).toBe(source);
 expect(writeView(source,'columnSize',undefined)).toBe(source);
 expect(writeView(source,'columnSize',{'file.name':100},1)).toBe(source.replace('# tail','    columnSize:\n      file.name: 100\n# tail'));
 expect(writeView(source.replaceAll('\n','\r\n'),'columnSize',{'note.due':196,'note.status':40})).toBe(sized.replaceAll('\n','\r\n'));
 expect(baseModel(writeView(source,'columnSize',{'note.a: b':99.5})).sizes).toEqual({'note.a: b':99.5});
 expect(baseModel(sized).sizes).toEqual({'note.due':196,'note.status':40});
});
it("reorders a key before or after the target and rewrites only the order/sort block",()=>{
 expect(reordered(['name','due','status'],2,1)).toEqual(['name','status','due']);
 expect(reordered(['name','due','status'],0,3)).toEqual(['due','status','name']);
 expect(reordered(['name','due','status'],1,2)).toEqual(['name','due','status']);
 expect(writeView(source,'order',['status','file.name','due'])).toBe(source.replace('    order: [file.name, due, status]\n','    order:\n      - status\n      - file.name\n      - due\n'));
 const sorts=[{property:'due',direction:'ASC' as const},{property:'file.name',direction:'DESC' as const}];
 const sorted=writeView(source,'sort',sorts);
 expect(writeView(sorted,'sort',reordered(sorts,0,2))).toBe(sorted.replace('      - property: due\n        direction: ASC\n      - property: file.name\n        direction: DESC\n','      - property: file.name\n        direction: DESC\n      - property: due\n        direction: ASC\n'));
});
