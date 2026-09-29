Pod::Spec.new do |s|
  s.name           = 'CallDirectory'
  s.version        = '1.0.0'
  s.summary        = 'iOS Call Directory blocking for Call Blocker'
  s.description    = 'Compiles the app\'s Rules into the Effective block list, stores it in an App Group container and hands it to the Call Directory extension the config plugin installs.'
  s.author         = 'Call Blocker'
  s.license        = { :type => 'MIT', :file => '../LICENSE' }
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
