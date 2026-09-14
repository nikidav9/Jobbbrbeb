<?php
require_once __DIR__ . '/../php-proxy/sitemap_cache.php';

function expect_cache(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "FAIL: $message\n");
        exit(1);
    }
}

$dir = sys_get_temp_dir() . '/jobtoo-sitemap-cache-' . bin2hex(random_bytes(4));
expect_cache(mkdir($dir), 'temporary directory');
$path = $dir . '/sitemap.xml';
$xml = '<?xml version="1.0"?><urlset><url><loc>https://jobtoo.ru/</loc></url></urlset>';
$xml2 = '<?xml version="1.0"?><urlset><url><loc>https://jobtoo.ru/v/1</loc></url></urlset>';

expect_cache(sm_cache_read($path, 1000, 60) === null, 'missing cache is a miss');
expect_cache(sm_cache_write($path, $xml), 'valid XML is written');
expect_cache(touch($path, 1000), 'cache timestamp is controlled');
expect_cache(sm_cache_read($path, 1059, 60) === $xml, 'fresh cache is returned');
expect_cache(sm_cache_read($path, 1060, 60) === null, 'cache expires at TTL');

expect_cache(file_put_contents($path, 'not xml') !== false, 'invalid fixture is written');
expect_cache(touch($path, 2000), 'invalid fixture timestamp is controlled');
expect_cache(sm_cache_read($path, 2001, 60) === null, 'invalid cache is rejected');
expect_cache(!sm_cache_write($path, '<urlset/>'), 'invalid write is rejected');

expect_cache(sm_cache_write($path, $xml2), 'cache is replaced atomically');
expect_cache(file_get_contents($path) === $xml2, 'replacement is complete');

unlink($path);
rmdir($dir);
echo "sitemap_cache_test: OK\n";
