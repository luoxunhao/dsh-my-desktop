param(
    [Parameter(Mandatory = $true)][ValidateSet('add','remove')][string]$Action,
    [Parameter(Mandatory = $true)][string]$BinDir
)

# Normalize (strip trailing backslash/space).
$target = $BinDir.TrimEnd('\', ' ')

try {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if (-not [string]::IsNullOrEmpty($userPath)) {
        $parts = @($userPath -split ';' | Where-Object { $_ -ne '' })
    }

    $exact = $target.TrimEnd('\')
    $already = @($parts | Where-Object { ($_.TrimEnd('\')) -ieq $exact })

    if ($Action -eq 'add') {
        if ($already.Count -eq 0) {
            if ($parts.Count -eq 0) {
                $newValue = $target
            } else {
                $newValue = ($parts -join ';') + ';' + $target
            }
            [Environment]::SetEnvironmentVariable('Path', $newValue, 'User')
            Write-Output "added:$target"
        } else {
            Write-Output "present:$target"
        }
    } else {
        # remove
        if ($already.Count -gt 0) {
            $kept = @($parts | Where-Object { ($_.TrimEnd('\')) -ine $exact })
            [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
            Write-Output "removed:$target"
        } else {
            Write-Output "absent:$target"
        }
    }
} catch {
    Write-Error "dsh-path: $($_.Exception.Message)"
    exit 1
}
