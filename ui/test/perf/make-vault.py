# Writes a benchmark vault: 3,000 linked notes in 8 folders (5 of them long), with tags, tasks,
# math, tables and code blocks. Usage: python3 make-vault.py OUT_DIR
import random, os, sys
random.seed(7)
root = sys.argv[1]
words = 'the of and to in is that for it as with was on be by this are from at or an have not which but were has more one all their can they also its been some other when would time about into there these two may then first any work like over such only new used year well even most after made many through back where much should because each people how just those very part while between'.split()
N = 3000
folders = ['Projects', 'Areas', 'Resources', 'Archive', 'Daily', 'Notes/Math', 'Notes/CS', 'Notes/Bio']
names = [f"{random.choice(folders)}/Note {i:04d} {' '.join(random.sample(words, 2))}" for i in range(N)]
def para():
    return ' '.join(random.choice(words) for _ in range(random.randint(20, 60))).capitalize() + '.'
for i, n in enumerate(names):
    lines = [f'---\ntags: [{random.choice(["project", "idea", "ref", "todo"])}]\ncreated: 2025-0{random.randint(1, 9)}-1{random.randint(0, 9)}\n---', f'# {n.split("/")[-1]}', '']
    for s in range(60 if i < 5 else random.randint(2, 6)):
        lines.append(f'## Section {s}')
        lines.append(para() + f' See [[{random.choice(names).split("/")[-1]}]] and #{random.choice(["topic", "area/sub", "misc"])}.')
        if random.random() < 0.3: lines += ['', f'- [ ] {random.choice(words)} task {s} 📅 2026-10-0{random.randint(1, 9)}', '- [x] done thing']
        if random.random() < 0.2: lines += ['', '$$', f'\\int_0^{s} x^2\\,dx = \\frac{{{s}^3}}{{3}}', '$$']
        if random.random() < 0.15: lines += ['', '| a | b | c |', '|---|---|---|', f'| {s} | {s * 2} | {s * 3} |']
        if random.random() < 0.15: lines += ['', '```python', f'def f{s}(x):', '    return x * 2', '```']
        lines.append('')
    p = os.path.join(root, n + '.md'); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write('\n'.join(lines))
