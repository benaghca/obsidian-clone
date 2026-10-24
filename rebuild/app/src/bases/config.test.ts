import {expect,it} from "vitest";
import {writeView} from "./write";
import {baseModel} from "./model";
const source='# keep\nviews:\n  - type: table\n    name: "Old"\n    rowHeight: tall\n    # keep too\n  - type: table\n    name: Other\n# end\n';
it("renames one view and preserves comments, other views and CRLF",()=>{
 expect(writeView(source,'name','New: view')).toBe(source.replace('name: "Old"','name: "New: view"'));
 expect(writeView(source.replaceAll('\n','\r\n'),'name','New')).toBe(source.replace('name: "Old"','name: New').replaceAll('\n','\r\n'));
 expect(writeView('','name','New')).toBe('views:\n  - type: table\n    name: New\n');
 expect(writeView('views:\n  - name: Old\n    type: table\n','name','New')).toBe('views:\n  - name: New\n    type: table\n');
});
it("writes native rowHeight values, clears Short and inserts in the selected view",()=>{
 for(const[value,height]of [['medium',60],['tall',120],['extra',240]] as const){const next=writeView(source,'rowHeight',value);expect(next).toBe(source.replace('rowHeight: tall',`rowHeight: ${value}`));expect(baseModel(next).rowHeight).toBe(height);}
 const short=writeView(source,'rowHeight',undefined);expect(short).toBe(source.replace('    rowHeight: tall\n',''));expect(baseModel(short).rowHeight).toBe(30);
 expect(writeView(source,'rowHeight','extra',1)).toBe(source.replace('# end','    rowHeight: extra\n# end'));
 expect(baseModel(source.replace('rowHeight: tall','rowHeight: unknown')).rowHeight).toBe(30);
});
