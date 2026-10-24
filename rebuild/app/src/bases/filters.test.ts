import {expect,it} from "vitest";
import {changeFilter,comparison,countFilters,filterExpression,group,literal} from "./filters";
import {baseModel} from "./model";
import {addView,writeFilters} from "./write";
import {readYaml} from "./yaml";
const source=`# preface
filters:
  not:
    - status == "waiting"
# before formulas
formulas:
  late: 'if(due < today(), "late", "")'
views:
  - type: table
    name: "Quoted"
    filters:
      or:
        - file.hasTag("work")
        - priority > 1
    # after filter
    order: [file.name, status]
  - type: table
    name: Other
    limit: 3
# tail
extra: 'untouched'
`;
it("replaces global or selected-view filters without touching other bytes",()=>{
 const value={and:['status != "done"',{or:['priority >= 3','file.hasTag("work")']}]};
 const global=writeFilters(source,value);
 expect(global).toBe(source.replace('filters:\n  not:\n    - status == "waiting"\n','filters:\n  and:\n    - status != "done"\n    - or:\n        - priority >= 3\n        - file.hasTag("work")\n'));
 expect(readYaml(global).filters).toEqual(value);
 expect(writeFilters(source,{not:[]},0)).toBe(source.replace('    filters:\n      or:\n        - file.hasTag("work")\n        - priority > 1\n','    filters:\n      not: []\n'));
 expect(writeFilters(source,{and:['priority == 0']},1)).toBe(source.replace('    limit: 3\n','    limit: 3\n    filters:\n      and:\n        - priority == 0\n'));
});
it("inserts missing filters and preserves CRLF, quotes and the last newline",()=>{
 expect(writeFilters('# head\nviews: []\n',{and:[]})).toBe('filters:\n  and: []\n# head\nviews: []\n');
 const text='note.x == "# c: d"';
 expect(writeFilters('filters: \'note.x == "# a: b"\'',{or:[text]})).toBe('filters:\n  or:\n    - '+JSON.stringify(text));
 const crlf=source.replaceAll('\n','\r\n');
 const next=writeFilters(crlf,{not:['priority < 0']},0);
 expect(next.replaceAll('\r\n','\n')).toBe(writeFilters(source,{not:['priority < 0']},0));
 expect(next.split('\r\n').join('')).not.toContain('\n');
});
it("appends a view before trailing comments and leaves every existing view byte alone",()=>{
 const next=addView(source,'View 1');
 expect(next).toBe(source.replace('# tail','  - type: table\n    name: View 1\n# tail'));
 expect(baseModel(next,1).name).toBe('Other');expect(baseModel(next,2).name).toBe('View 1');
 expect(baseModel(next,99).name).toBe('View 1');
 for(const empty of ['', '# heading\n', 'views: []\n'])expect((readYaml(addView(empty,'View 1')).views as unknown[])).toHaveLength(2);
 expect(addView('views:\r\n  - name: "Old"', 'View 2')).toBe('views:\r\n  - name: "Old"\r\n  - type: table\r\n    name: View 2\r\n');
});
it("edits nested groups without losing sibling expressions and handles empty groups",()=>{
 const filter={or:['priority > 1',{not:['status == "done"']}]};
 expect(changeFilter(filter,[1,0],()=> 'status == "waiting"')).toEqual({or:['priority > 1',{not:['status == "waiting"']}]});
 expect(countFilters(filter)).toBe(2);expect(countFilters({unsupported:[]})).toBe(1);expect(group(undefined)).toEqual({op:'and',children:[]});
});
it("recognizes editable comparisons without interpreting compound expressions as literals",()=>{
 for(const text of ['priority >= 3','status != "done"','file.inFolder("BaseTest")','file.hasTag("work")','tags.contains("tag")','due < today()','active == false'])expect(filterExpression(comparison(text)!)).toBe(text);
 for(const text of ['priority > 1 && status != "done"','file.name == note.status','unknown("x")'])expect(comparison(text)).toBeNull();
 expect(literal('a"b','text')).toBe('"a\\"b"');expect(literal('false','checkbox')).toBe('false');
 expect(()=>literal('NaN','number')).toThrow();
});
