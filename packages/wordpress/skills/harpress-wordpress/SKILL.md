# WordPress

Use the current Harpress project's connected WordPress site by default. Browse page titles with `wordpress_list_pages` and read a page with `wordpress_read_page`. In Code Mode these tools are `wordpress.list_pages` and `wordpress.read_page`.

When `wordpress_list_content` and `wordpress_get_content` are available, use them to search and read pages and posts in the current project. For edits, use `wordpress_update_content`, which opens a confirmation before each save. In Code Mode these are `wordpress.list_content`, `wordpress.get_content`, and `wordpress.update_content`.

If the tool reports that the project is disconnected, direct the user to **Connect WordPress** in the project's settings. That form is where the user enters their WordPress username and application password. Never ask for the password in the chat.

If the user names a different site, have them open that project in Harpress. For a connection or permission error, describe the issue without exposing credentials.
