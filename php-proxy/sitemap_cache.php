<?php

function sm_cache_valid(string $xml): bool
{
    $trimmed = ltrim($xml);
    return str_starts_with($trimmed, '<?xml') && str_contains($xml, '<urlset');
}

function sm_cache_read(string $path, int $now, int $ttl): ?string
{
    if ($ttl <= 0 || !is_file($path)) return null;

    $mtime = @filemtime($path);
    if ($mtime === false || $now - $mtime >= $ttl) return null;

    $xml = @file_get_contents($path);
    return is_string($xml) && sm_cache_valid($xml) ? $xml : null;
}

function sm_cache_write(string $path, string $xml): bool
{
    if (!sm_cache_valid($xml)) return false;

    $tmp = $path . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, $xml, LOCK_EX) === false) return false;
    if (@rename($tmp, $path)) return true;

    @unlink($tmp);
    return false;
}
