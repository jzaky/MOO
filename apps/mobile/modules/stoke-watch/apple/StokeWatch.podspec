Pod::Spec.new do |s|
  s.name           = 'StokeWatch'
  s.version        = '1.0.0'
  s.summary        = 'WatchConnectivity bridge between Stoke and its Apple Watch companion.'
  s.description    = 'Sends the live workout state to the watch and forwards watch actions to JavaScript.'
  s.license        = 'UNLICENSED'
  s.author         = 'Stoke'
  s.homepage       = 'https://example.invalid/stoke'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
