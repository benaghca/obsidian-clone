//! Linked mentions for requested destinations, without shipping every source line.
use super::{is_note_path, Index};
use crate::model::Backlink;
use std::collections::{BTreeMap, BTreeSet};

impl Index {
    pub fn backlinks(&self, paths: &[String]) -> BTreeMap<String, Vec<Backlink>> {
        let wanted: BTreeSet<&String> = paths.iter().collect();
        let mut found: BTreeMap<String, Vec<Backlink>> = BTreeMap::new();
        if wanted.is_empty() {
            return found;
        }
        for (from, node) in &self.files {
            if node.is_dir || !is_note_path(from) {
                continue;
            }
            for link in &node.note.links {
                let Some(target) = self.resolve(from, &link.target) else {
                    continue;
                };
                if wanted.contains(&target) {
                    found.entry(target).or_default().push(Backlink {
                        from: from.clone(),
                        line: link.line,
                        text: link.text.clone(),
                    });
                }
            }
        }
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_only_keep_occurrences_and_follow_relocated_sources_and_destinations() {
        let mut idx = Index::from_notes(&[
            ("dir/Target.md", "target"),
            ("dir/Other.md", "other"),
            ("dir/Source.md", "[[Target]] [[Target]] [md](Target.md) [[Other]]\n`[[Target]]`\n```\n[[Target]]\n```"),
            ("Outside.md", "[[dir/Target]]"),
        ]);
        assert!(idx.backlinks(&[]).is_empty());
        let paths = vec![
            "dir/Target.md".into(),
            "dir/Target.md".into(),
            "missing.md".into(),
        ];
        let before = idx.backlinks(&paths);
        assert_eq!(before.len(), 1);
        assert_eq!(before["dir/Target.md"].len(), 4);
        assert_eq!(before["dir/Target.md"][0].from, "Outside.md");
        assert_eq!(before["dir/Target.md"][1].line, 1);

        idx.relocate("dir", "moved");
        let after = idx.backlinks(&["moved/Target.md".into(), "dir/Target.md".into()]);
        assert_eq!(after.len(), 1);
        assert_eq!(after["moved/Target.md"].len(), 3);
        assert!(after["moved/Target.md"]
            .iter()
            .all(|b| b.from == "moved/Source.md"));
        // Outside's explicit old path no longer resolves; the retained snapshot does.
        assert_eq!(before["dir/Target.md"].len(), 4);
        idx.relocate("moved/Target.md", "Renamed.md");
        assert!(idx
            .backlinks(&["Renamed.md".into(), "moved/Target.md".into()])
            .is_empty());
    }
}
