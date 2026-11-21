//! Linked mentions for requested destinations, without shipping every source line.
#[cfg(test)]
use super::{BacklinkReply, Index, ReplyStep};
#[cfg(test)]
use crate::model::Backlink;
#[cfg(test)]
use std::collections::BTreeMap;

#[cfg(test)]
impl Index {
    /// Read from the link table's reverse index: only the notes that link to `paths` are
    /// visited, in path order, each link in note order (the order a walk of every note gave).
    /// The same steps `link_reads` takes between holds of the lock, taken at once.
    pub fn backlinks(&self, paths: &[String]) -> BTreeMap<String, Vec<Backlink>> {
        debug_assert!(!self.links.has_pending(), "link table read before it settled");
        let mut reply = BacklinkReply::new(paths);
        while reply.step(self) == ReplyStep::More {}
        reply.finish()
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
