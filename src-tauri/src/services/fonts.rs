//! Local font discovery for display preferences. No font files leave the app.
pub fn list_system_fonts() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    let mut families: Vec<String> = database
        .faces()
        .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
        .filter(|name| !name.trim().is_empty() && !name.starts_with('.'))
        .collect();
    families.sort_by_cached_key(|name| name.to_lowercase());
    families.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    families
}

#[cfg(test)]
mod tests {
    #[test]
    fn discovery_returns_sorted_unique_visible_family_names() {
        let names = super::list_system_fonts();
        assert!(
            names
                .iter()
                .all(|name| !name.trim().is_empty() && !name.starts_with('.'))
        );
        assert!(
            names
                .windows(2)
                .all(|pair| pair[0].to_lowercase() < pair[1].to_lowercase())
        );
    }
}
