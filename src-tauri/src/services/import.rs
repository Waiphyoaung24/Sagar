//! Import use case: validate, parse, snapshot and persist a new translation
//! project from a user-selected EPUB file. The original file is never
//! modified; only an app-owned copy is written (invariant: source
//! immutability).

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::domain::ImportResult;
use crate::epub;
use crate::error::AppError;
use crate::storage::{self, projects};

/// Imports `source_path` into app-owned storage under `data_dir`.
///
/// When the same source content is already imported and `allow_duplicate` is
/// false, returns a `duplicate_project` error whose `details` carry the
/// existing [`ProjectSummary`] so the UI can offer resume-or-separate.
pub fn import_epub(
    data_dir: &Path,
    source_path: &Path,
    allow_duplicate: bool,
) -> Result<ImportResult, AppError> {
    import_epub_with_app_language(data_dir, source_path, allow_duplicate, "en")
}

/// The app language sets the initial target for a new project only.
/// English/Myanmar and unknown preferences keep the historical Myanmar default.
pub fn import_epub_with_app_language(
    data_dir: &Path,
    source_path: &Path,
    allow_duplicate: bool,
    app_language: &str,
) -> Result<ImportResult, AppError> {
    let target_language = match app_language {
        "zh" => "zh",
        "ja" => "ja",
        "ko" => "ko",
        "th" => "th",
        "shn" => "shn",
        "rki" => "rki",
        "mnw" => "mnw",
        _ => "my",
    };
    let metadata = std::fs::metadata(source_path)?;
    if metadata.is_dir() {
        return Err(AppError::new(
            "invalid_source",
            "The selected EPUB is a folder. Choose a packaged .epub file, or package this folder as an EPUB archive before importing.",
        ));
    }
    if !metadata.is_file() {
        return Err(AppError::new(
            "invalid_source",
            "The selected path is not a file.",
        ));
    }

    let sha256 = hash_file(source_path)?;

    storage::initialize(data_dir)?;
    let mut conn = storage::open_database(&data_dir.join("sagar.db"))?;

    if !allow_duplicate && let Some(existing) = projects::find_by_source_hash(&conn, &sha256)? {
        return Err(AppError::with_details(
            "duplicate_project",
            format!("“{}” is already in your library.", existing.title),
            serde_json::to_value(&existing).unwrap_or(serde_json::Value::Null),
        ));
    }

    let parsed = epub::inspect(source_path)?;

    let project_id = uuid::Uuid::new_v4().to_string();
    let snapshot_rel_path = format!("projects/{project_id}/source.epub");
    let snapshot_abs_path = data_dir.join(&snapshot_rel_path);
    if let Some(parent) = snapshot_abs_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(source_path, &snapshot_abs_path)?;

    let original_source_path = source_path.canonicalize()?;
    let now = chrono::Utc::now().to_rfc3339();
    let new_project = projects::NewProject {
        id: project_id.clone(),
        source_sha256: sha256,
        original_source_path: Some(original_source_path.to_string_lossy().into_owned()),
        source_snapshot_path: snapshot_rel_path,
        title: parsed
            .metadata
            .title
            .clone()
            .unwrap_or_else(|| "Untitled book".to_string()),
        author: parsed.metadata.author.clone(),
        source_language: parsed.metadata.language.clone(),
        target_language: target_language.to_string(),
        created_at: now,
    };

    let mut new_chapters = Vec::new();
    for chapter in &parsed.chapters {
        let chapter_id = uuid::Uuid::new_v4().to_string();
        let new_chapter = projects::NewChapter {
            id: chapter_id.clone(),
            spine_index: new_chapters.len() as i64,
            manifest_item_id: chapter.manifest_item_id.clone(),
            resource_href: chapter.resource_href.clone(),
            title: chapter.title.clone(),
        };
        let mut new_blocks = Vec::new();
        for (block_index, block) in chapter.blocks.iter().enumerate() {
            new_blocks.push(projects::NewBlock {
                id: uuid::Uuid::new_v4().to_string(),
                block_index: block_index as i64,
                structural_locator: block.structural_locator.clone(),
                element_name: block.element_name.clone(),
                source_xhtml_fragment: block.source_xhtml_fragment.clone(),
                source_plain_text: block.source_plain_text.clone(),
                is_translatable: block.is_translatable,
                supported: block.supported,
            });
        }
        new_chapters.push((new_chapter, new_blocks));
    }

    projects::create_project(&mut conn, &new_project, &new_chapters)?;

    // Book-level warnings plus per-chapter findings, located by chapter title
    // so the UI can point the user at the right place.
    let mut warnings = parsed.warnings;
    for chapter in &parsed.chapters {
        for warning in &chapter.warnings {
            warnings.push(crate::domain::ImportWarning {
                code: warning.code.clone(),
                message: warning.message.clone(),
                location: Some(chapter.title.clone()),
            });
        }
    }

    Ok(ImportResult {
        project: projects::get_project(&conn, &project_id)?,
        chapters: projects::list_chapters(&conn, &project_id)?,
        warnings,
    })
}

pub(crate) fn hash_file(path: &Path) -> Result<String, AppError> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    Ok(hex)
}
