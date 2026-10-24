import {expect,it,vi} from "vitest";
vi.mock("../fileOps",()=>({newNote:vi.fn()}));
vi.mock("../editor/clipboard",()=>({writeClipboard:vi.fn()}));
import {writeView} from "./write";
import {rowSeed} from "./newRow";
import {tableTsv} from "./results";
const source='# head\nfilters: \'status != "done"\'\nviews:\n  - type: table\n    name: "One"\n    limit: 3\n    # retained\n  - type: table\n    name: Other\n# tail\n';
it("edits or clears only the selected limit, preserving comments, views, quotes and CRLF",()=>{
 expect(writeView(source,'limit',2)).toBe(source.replace('limit: 3','limit: 2'));
 expect(writeView(source,'limit',undefined)).toBe(source.replace('    limit: 3\n',''));
 expect(writeView(source,'limit',0,1)).toBe(source.replace('# tail','    limit: 0\n# tail'));
 expect(writeView(source.replaceAll('\n','\r\n'),'limit',2)).toBe(source.replace('limit: 3','limit: 2').replaceAll('\n','\r\n'));
});
it("seeds native frontmatter through the existing writer and skips file/formula columns",()=>{
 expect(rowSeed(['file.name','status','due','priority','formula.late'],[{not:['status == "waiting"']},{or:['file.hasTag("work")','priority > 1']}],new Map())).toEqual({folder:'',text:'---\ntags:\n  - work\nstatus:\ndue:\npriority:\n---\n'});
 expect(rowSeed(['file.name','status','priority'],[{and:['file.inFolder("BaseTest")','status == "open"','priority == 3','active == true']}],new Map())).toEqual({folder:'BaseTest',text:'---\nstatus: open\npriority: 3\nactive: true\n---\n'});
 expect(rowSeed(['note.status'],[{or:['status == "open"','status == "done"']},{not:['file.inFolder("Wrong")']},{unsupported:[]}],new Map())).toEqual({folder:'',text:'---\nstatus:\n---\n'});
});
it("copies all visible result values as TSV without DOM truncation",()=>{
 expect(tableTsv(['Task','status','Due date','priority'],[['Task A','open','2000-01-01',3],['Task E','',null,null]])).toBe('Task\tstatus\tDue date\tpriority\nTask A\topen\t2000-01-01\t3\nTask E\t\t\t');
 expect(tableTsv(['tags','active','text'],[[['a','b'],false,'a\tb\n"c"']])).toBe('tags\tactive\ttext\na, b\tfalse\t"a\tb\n""c"""');
});
