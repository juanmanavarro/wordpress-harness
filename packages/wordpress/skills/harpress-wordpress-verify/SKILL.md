# Verify WordPress content

Call the WordPress page reader and compare the current content with what the user expects. Report the title, link, and what you could verify. If the page is missing or the REST API fails, report that outcome.

After an edit, use `wordpress_get_content` with the same kind and ID and `view: "editable"`. Check the changed fields and the publication status against the values expected. If WordPress timed out while saving, read the item before deciding whether the change needs another attempt.
