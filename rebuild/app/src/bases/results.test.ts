import {beforeEach,expect,it,vi} from "vitest";
vi.mock("../fileOps",()=>({newNote:vi.fn()}));
vi.mock("../editor/clipboard",()=>({writeClipboard:vi.fn()}));
vi.mock("../shell/notice",()=>({notice:vi.fn()}));
vi.mock("../vaultRoot",async original=>({...await original<typeof import("../vaultRoot")>(),sourceVault:()=>"/tmp/vault"}));
vi.mock("../vaultWrite",async original=>({...await original<typeof import("../vaultWrite")>(),submitBytes:vi.fn(async()=>{})}));
import {writeView} from "./write";
import {rowSeed} from "./newRow";
import {submitBytes} from "../vaultWrite";
import {notice} from "../shell/notice";
import type {Property} from "../editor/frontmatter";
import type {FileEntry} from "../api";
import type {Workspace} from "../workspace";
import {baseModel,type Row} from "./model";
import {formatDate} from "../settings/dateFormat";
import {csvBytes,csvDefaultPath,csvFilename,csvPath,entryText,EXPORT_CSV_TITLE,exportCsv,shownText,tableCsv,tableOf,tableTsv} from "./results";
const source='# head\nfilters: \'status != "done"\'\nviews:\n  - type: table\n    name: "One"\n    limit: 3\n    # retained\n  - type: table\n    name: Other\n# tail\n';
const prop=(key:string,type:Property["type"],value:Property["value"]):Property=>({key,type,value,line:0,count:1});
const file=(path:string):FileEntry=>({path,name:path.replace(/^.*\//,"").replace(/\.md$/,""),is_dir:false,mtime_ms:Date.UTC(2024,0,2,3,4,5),ctime_ms:1,size:1});
const row=(path:string,props:Property[]=[]):Row=>({file:file(path),props,tags:[],hasLink:()=>false});
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
it("copies the shown cells as TSV without DOM truncation",()=>{
 expect(tableTsv({headers:['Task','status','Due date','priority'],rows:[['Task A','open','2000-01-01','3'],['Task E','','','']]})).toBe('Task\tstatus\tDue date\tpriority\nTask A\topen\t2000-01-01\t3\nTask E\t\t\t');
 expect(tableTsv({headers:['tags','active','text'],rows:[['a, b','false','a\tb\n"c"']]})).toBe('tags\tactive\ttext\na, b\tfalse\t"a\tb\n""c"""');
});
it("writes RFC 4180 CSV: CRLF records, and only fields with a comma, quote, CR or LF quoted",()=>{
 expect(tableCsv({headers:['Task','status'],rows:[['Task A','open'],['Task E','']]})).toBe('Task,status\r\nTask A,open\r\nTask E,\r\n');
 expect(tableCsv({headers:['tags','text'],rows:[['a, b','a\tb\n"c"']]})).toBe('tags,text\r\n"a, b","a\tb\n""c"""\r\n');
 expect(tableCsv({headers:['say'],rows:[['he said "hi",\r\nthen'],['lone\rcr'],[' padded '],['"']]})).toBe('say\r\n"he said ""hi"",\r\nthen"\r\n"lone\rcr"\r\n padded \r\n""""\r\n');
 expect(tableCsv({headers:['A','B'],rows:[]})).toBe('A,B\r\n');
 // One field per column, whatever the text: a quoted comma does not split it.
 const line=tableCsv({headers:['x','y','z'],rows:[['1,2','3','']]}).split('\r\n')[1];
 expect(line).toBe('"1,2",3,');
});
it("encodes the file as UTF-8 without a byte order mark",()=>{
 const bytes=csvBytes({headers:['Name'],rows:[['café 🎉'],['日本']]});
 expect([...bytes.slice(0,4)]).toEqual([0x4e,0x61,0x6d,0x65]);
 expect(new TextDecoder('utf-8',{fatal:true}).decode(bytes)).toBe('Name\r\ncafé 🎉\r\n日本\r\n');
 expect([...new TextEncoder().encode('é')]).toEqual([0xc3,0xa9]);
 expect(bytes.length).toBe(new TextEncoder().encode('Name\r\ncafé 🎉\r\n日本\r\n').length);
});
it("names the file <base>-<view>.csv, made safe for a file name",()=>{
 expect(csvFilename('Tasks.base','By due')).toBe('Tasks-By due.csv');
 expect(csvFilename('Tasks','By due')).toBe('Tasks-By due.csv');
 // Regression: the old download was named after the view alone.
 expect(csvFilename('Tasks.base','By due')).not.toBe('By due.csv');
 expect(csvFilename('Project notes.md','Table')).toBe('Project notes-Table.csv');
 expect(csvFilename('a/b:c*?"<>|.base','v\\w\n\tx')).toBe('a b c-v w x.csv');
 expect(csvFilename('..hidden','view.')).toBe('hidden-view.csv');
 expect(csvFilename('Tasks','  ')).toBe('Tasks.csv');
 expect(csvFilename('','View')).toBe('View.csv');
 expect(csvFilename(null,null)).toBe('Results.csv');
 expect(csvFilename('x'.repeat(300),'v').length).toBe(204);
 expect(csvDefaultPath('Projects/Work/Tasks.base','By due')).toBe('Projects/Work/Tasks-By due.csv');
 expect(csvDefaultPath('Tasks.base','Table')).toBe('Tasks-Table.csv');
 expect(csvDefaultPath(null,'Table')).toBe('Table.csv');
});
it("tidies a typed save path and refuses ones outside the vault",()=>{
 expect(csvPath(' Exports/Tasks-By due ')).toEqual({path:'Exports/Tasks-By due.csv'});
 expect(csvPath('/Exports//./Tasks.CSV')).toEqual({path:'Exports/Tasks.CSV'});
 expect(csvPath('Exports\\Tasks.csv')).toEqual({path:'Exports/Tasks.csv'});
 expect(csvPath('notes.txt')).toEqual({path:'notes.txt.csv'});
 expect(csvPath('   ')).toEqual({error:'Type a file name'});
 expect(csvPath('../Tasks.csv')).toEqual({error:'Choose a path inside this vault'});
 expect(csvPath('.grove/Tasks.csv')).toEqual({error:'Names cannot start with a dot'});
});
it("formats cells as they are displayed, not as stored",()=>{
 // Note properties show their frontmatter value in the column's type.
 expect(shownText('related',['[[Alpha]]','b'],prop('related','list',['[[Alpha|First]]','[[Beta]]','plain']),'list')).toBe('First, Beta, plain');
 expect(shownText('tags',['a','b'],prop('tags','tags',['a','b']),'tags')).toBe('a, b');
 expect(shownText('done',true,prop('done','checkbox',true),'checkbox')).toBe('true');
 expect(shownText('done',false,prop('done','checkbox',false),'checkbox')).toBe('false');
 expect(shownText('due','2024-01-05',prop('due','text','2024-01-05'),'date')).toBe('2024-01-05');
 expect(shownText('at','2024-01-05T10:30:00',prop('at','datetime','2024-01-05T10:30:00'),'datetime')).toBe('2024-01-05T10:30:00');
 expect(shownText('priority',3,prop('priority','number','3'),'number')).toBe('3');
 // A value that does not fit the column's type is shown as written, as the cell's editor shows it.
 expect(shownText('priority','high',prop('priority','text','high'),'number')).toBe('high');
 // A note without the property shows an empty cell.
 expect(shownText('status',null,undefined,'text')).toBe('');
 expect(shownText('done',null,undefined,'checkbox')).toBe('');
 // File and formula columns show the evaluated value.
 expect(shownText('file.name','Alpha',undefined,'text')).toBe('Alpha');
 expect(shownText('file.mtime','2024-01-02T03:04:05.000Z',undefined,'datetime')).toBe(formatDate(new Date('2024-01-02T03:04:05.000Z'),'YYYY-MM-DDTHH:mm:ss'));
 expect(shownText('file.mtime','2024-01-02T03:04:05.000Z',undefined,'datetime')).not.toContain('Z');
 expect(shownText('file.tags',['x','y'],undefined,'tags')).toBe('x, y');
 expect(shownText('formula.ok',false,undefined,'checkbox')).toBe('false');
 expect(shownText('formula.n',0.25,undefined,'number')).toBe('0.25');
 expect(shownText('formula.empty','',undefined,'text')).toBe('');
});
it("exports the shown rows and columns in the view's order, under display names, with displayed values",()=>{
 const base=`filters: 'status != "done"'
properties:
  note.status:
    displayName: State
  file.name:
    displayName: Task
views:
  - type: table
    name: By due
    order: [file.name, status, due, tags, file.mtime]
    limit: 3
    sort:
      - property: due
        direction: DESC
`;
 const model=baseModel(base);
 const rows=[
  row('A.md',[prop('status','text','open'),prop('due','date','2024-01-01'),prop('tags','tags',['x','y']),prop('hidden','text','secret')]),
  row('B.md',[prop('status','text','done'),prop('due','date','2025-01-01')]),
  row('C.md',[prop('status','text','open'),prop('due','date','2026-01-01'),prop('tags','tags',['z'])]),
  row('D.md',[prop('status','text','waiting'),prop('due','date','2023-01-01')]),
  row('E.md',[prop('status','text','open'),prop('due','date','2022-01-01')]),
 ];
 const kinds:Record<string,Property["type"]>={status:'text',due:'date',tags:'tags','file.mtime':'datetime'};
 const shown=model.select(rows);
 const table=tableOf(model.columns,model.label,shown,(key,entry)=>entryText(key,entry,undefined,k=>kinds[k]??'text'));
 const mtime=formatDate(new Date(Date.UTC(2024,0,2,3,4,5)),'YYYY-MM-DDTHH:mm:ss');
 expect(table).toEqual({headers:['Task','State','due','tags','modified time'],rows:[
  ['C','open','2026-01-01','z',mtime],
  ['A','open','2024-01-01','x, y',mtime],
  ['D','waiting','2023-01-01','',mtime],
 ]});
 const csv=tableCsv(table);
 expect(csv).not.toContain('secret');
 expect(csv).not.toContain('B');
 expect(csv).not.toContain('E,');
 expect(csv.split('\r\n')[0]).toBe('Task,State,due,tags,modified time');
 // A failing value shows its message; a vault type that fits wins over the stored one.
 const failing={context:{get:()=>{throw Error('Formula value is too large');}},row:{props:[]}};
 expect(entryText('formula.big',failing,undefined,()=>'text')).toBe('Formula value is too large');
 const typed={context:{get:()=>'3'},row:{props:[prop('n','text','3')]}};
 expect(entryText('n',typed,'number',(_k,v)=>typeof v==='number'||v==='3'?'number':'text')).toBe('3');
});
it("builds a 10,000-row export without a hitch",()=>{
 const model=baseModel(`views:\n  - order: [file.name, status, due, tags, rank]\n    sort:\n      - property: rank\n        direction: DESC\n`);
 const rows=Array.from({length:10_000},(_,i)=>row(`N/${String(i).padStart(5,"0")}.md`,[prop('status','text',i%7?'open':'say "hi", then'),prop('due','date','2024-01-05'),prop('tags','tags',['a','b']),prop('rank','number',String(i))]));
 const shown=model.select(rows);
 const kinds:Record<string,Property["type"]>={status:'text',due:'date',tags:'tags',rank:'number'};
 const start=performance.now();
 const bytes=csvBytes(tableOf(model.columns,model.label,shown,(key,entry)=>entryText(key,entry,kinds[key],k=>kinds[k]??'text')));
 const ms=performance.now()-start;
 const lines=new TextDecoder().decode(bytes).split('\r\n');
 expect(lines[0]).toBe('file name,status,due,tags,rank');
 expect(lines[1]).toBe('09999,open,2024-01-05,"a, b",9999');
 expect(lines.length).toBe(10_002);
 expect(ms).toBeLessThan(150);
});
const fakeWs=()=>({vault:{name:'Vault',refreshFiles:vi.fn(async()=>{}),written:vi.fn()}}) as unknown as Workspace & {vault:{refreshFiles:ReturnType<typeof vi.fn>;written:ReturnType<typeof vi.fn>}};
const table={headers:['Task','note'],rows:[['A','café, "x"']]};
beforeEach(()=>{vi.mocked(submitBytes).mockClear();vi.mocked(notice).mockClear();});
it("writes nothing when the save dialog is cancelled",async()=>{
 const ws=fakeWs(),choose=vi.fn(async()=>null);
 expect(await exportCsv(ws,{source:'Projects/Tasks.base',view:'By due',table},choose)).toBe(null);
 expect(choose).toHaveBeenCalledWith(ws,'Projects/Tasks-By due.csv',table);
 expect(submitBytes).not.toHaveBeenCalled();
 expect(ws.vault.refreshFiles).not.toHaveBeenCalled();
 expect(notice).not.toHaveBeenCalled();
});
it("writes the CSV's UTF-8 bytes to the path the save dialog returns, not as a browser download",async()=>{
 const ws=fakeWs();
 expect(await exportCsv(ws,{source:'Projects/Tasks.base',view:'By due',table},async()=>'Exports/Mine.csv')).toBe('Exports/Mine.csv');
 expect(submitBytes).toHaveBeenCalledTimes(1);
 const [vault,path,bytes,op]=vi.mocked(submitBytes).mock.calls[0];
 expect([vault,path,op]).toEqual(['/tmp/vault','Exports/Mine.csv','replace']);
 expect(new TextDecoder().decode(bytes)).toBe('Task,note\r\nA,"café, ""x"""\r\n');
 expect(ws.vault.refreshFiles).toHaveBeenCalled();
 expect(ws.vault.written).toHaveBeenCalledWith('Exports/Mine.csv');
 expect(notice).toHaveBeenCalledWith(['Saved “Mine.csv”']);
 // A failed write says so and returns null.
 vi.mocked(submitBytes).mockRejectedValueOnce(Error('invalid path'));
 expect(await exportCsv(ws,{source:null,view:'V',table},async()=>'x.csv')).toBe(null);
 expect(notice).toHaveBeenLastCalledWith(['Couldn’t export “x.csv”: invalid path']);
});
it("has one action name for the menus",()=>{
 expect(EXPORT_CSV_TITLE).toBe('Export as CSV...');
});
