# REA 6.5.0 能力清单

直接读取本机发布包与 stdio MCP，CLI 153 项，MCP 207 项。CLI 使用 `--llms --format json` 和 `--llms-full --format json`；MCP 使用 `initialize` 后 `tools/list`，未打开分析目标。采集时间：2026-10-17T22:08:09.849Z。

CLI 与 MCP 不是一一映射。下表 related operations 表示关联服务，不保证输入/输出可替换；CLI 自带路径选择、临时会话生命周期和选项转换。所有命令的原始参数 Schema 保存在 cli-full-manifest.json；MCP 完整输入/输出 Schema 保存在 mcp-tools.json。

原生状态以本次快照为准：8 项 CLI 能力、4 项 MCP 离线工具已通过原生样本验证，标记 implemented-native-tested；其余 pending。四个 Evidence 文件命令只实现离线 CLI 语义，其对应的 MCP 会话工具仍 pending；compare-bundles 是 compare 的别名，不另计命令数量。没有任何 CLI fallback。功能是否在当前主机可用还取决于 provider、OS、外部引擎与运行时授权，应由执行层报告，不能根据目录存在判断。

## MCP 工具

| 工具 | CLI 关联 | 原生状态 | 声明来源（包内路径） |
|---|---|---|---|
| `annotate_native_function` | annotate-native-function | pending | `dist/contracts/officialToolContracts.js:26` |
| `inspect_native_load_image` | inspect-native-load-image | pending | `dist/contracts/officialToolContracts.js:27` |
| `inspect_native_data_type` | inspect-native-data-type | pending | `dist/contracts/officialToolContracts.js:28` |
| `inspect_native_instruction` | inspect-native-instruction | pending | `dist/contracts/officialToolContracts.js:29` |
| `resolve_native_call_targets` | resolve-native-call-targets | pending | `dist/contracts/officialToolContracts.js:30` |
| `address_name` | — | pending | `dist/contracts/officialToolContracts.js:31` |
| `comment` | — | pending | `dist/contracts/officialToolContracts.js:32` |
| `current_address` | — | pending | `dist/contracts/officialToolContracts.js:33` |
| `current_procedure` | — | pending | `dist/contracts/officialToolContracts.js:34` |
| `current_document` | — | pending | `dist/contracts/officialToolContracts.js:35`<br>`dist/contracts/promptContracts.js:59` |
| `goto_address` | — | pending | `dist/contracts/officialToolContracts.js:36` |
| `inline_comment` | — | pending | `dist/contracts/officialToolContracts.js:37` |
| `list_bookmarks` | — | pending | `dist/contracts/officialToolContracts.js:38` |
| `list_documents` | — | pending | `dist/contracts/officialToolContracts.js:39` |
| `list_names` | — | pending | `dist/contracts/officialToolContracts.js:40` |
| `list_procedures` | — | pending | `dist/contracts/officialToolContracts.js:41` |
| `list_segments` | — | pending | `dist/contracts/officialToolContracts.js:42` |
| `list_strings` | — | pending | `dist/contracts/officialToolContracts.js:43` |
| `next_address` | — | pending | `dist/contracts/officialToolContracts.js:44` |
| `prev_address` | — | pending | `dist/contracts/officialToolContracts.js:45` |
| `procedure_address` | — | pending | `dist/contracts/officialToolContracts.js:46`<br>`dist/contracts/promptContracts.js:63` |
| `procedure_assembly` | — | pending | `dist/contracts/officialToolContracts.js:47` |
| `procedure_callees` | — | pending | `dist/contracts/officialToolContracts.js:48`<br>`dist/contracts/promptContracts.js:75` |
| `procedure_callers` | — | pending | `dist/contracts/officialToolContracts.js:49`<br>`dist/contracts/promptContracts.js:74` |
| `procedure_info` | — | pending | `dist/contracts/officialToolContracts.js:50` |
| `read_function_instructions` | instructions | pending | `dist/contracts/officialToolContracts.js:51` |
| `search_bytes` | search-bytes | pending | `dist/contracts/hopperMemoryContracts.js:7` |
| `read_bytes` | read-bytes | pending | `dist/contracts/hopperMemoryContracts.js:21` |
| `address_to_file_offset` | address-to-file-offset | pending | `dist/contracts/hopperMemoryContracts.js:30` |
| `procedure_references` | — | pending | `dist/contracts/officialToolContracts.js:53` |
| `procedure_pseudo_code` | decompile | pending | `dist/contracts/officialToolContracts.js:58` |
| `resolve_containing_procedure` | — | pending | `dist/contracts/officialToolContracts.js:59`<br>`dist/contracts/promptContracts.js:179` |
| `search_procedures` | search | pending | `dist/contracts/officialToolContracts.js:60`<br>`dist/contracts/promptContracts.js:63` |
| `search_strings` | search | pending | `dist/contracts/officialToolContracts.js:61`<br>`dist/contracts/promptContracts.js:63` |
| `set_address_name` | — | pending | `dist/contracts/officialToolContracts.js:62` |
| `set_addresses_names` | — | pending | `dist/contracts/officialToolContracts.js:63` |
| `set_bookmark` | — | pending | `dist/contracts/officialToolContracts.js:64` |
| `set_comment` | — | pending | `dist/contracts/officialToolContracts.js:65` |
| `set_inline_comment` | — | pending | `dist/contracts/officialToolContracts.js:66` |
| `unset_bookmark` | — | pending | `dist/contracts/officialToolContracts.js:67` |
| `xrefs` | xrefs | pending | `dist/contracts/officialToolContracts.js:68`<br>`dist/contracts/promptContracts.js:73` |
| `trace_native_values` | trace-native-values | pending | `dist/contracts/enhancedToolContracts.js:31` |
| `inspect_native_dispatch_metadata` | inspect-native-dispatch-metadata | pending | `dist/contracts/enhancedToolContracts.js:19` |
| `get_objc_classes` | — | pending | `dist/contracts/enhancedToolContracts.js:20` |
| `get_objc_protocols` | — | pending | `dist/contracts/enhancedToolContracts.js:21` |
| `batch_decompile` | — | pending | `dist/contracts/enhancedToolContracts.js:22` |
| `get_call_graph` | — | pending | `dist/contracts/enhancedToolContracts.js:23` |
| `analyze_swift_types` | — | pending | `dist/contracts/enhancedToolContracts.js:24` |
| `find_xrefs_to_name` | — | pending | `dist/contracts/enhancedToolContracts.js:25` |
| `binary_overview` | analyze, inspect | pending | `dist/contracts/enhancedToolContracts.js:26` |
| `analyze_function` | function | pending | `dist/contracts/functionComparisonExample.js:49`<br>`dist/contracts/functionWorkflowToolContracts.js:27`<br>`dist/contracts/promptContracts.js:72`<br>`dist/contracts/toolContractExamples.js:51` |
| `inspect_native_api` | inspect-native-api | pending | `dist/contracts/functionWorkflowToolContracts.js:28` |
| `trace_feature` | trace | pending | `dist/contracts/enhancedToolContracts.js:28`<br>`dist/contracts/promptContracts.js:76` |
| `trace_call_path` | — | pending | `dist/contracts/enhancedToolContracts.js:29` |
| `trace_native_ui_action` | trace-native-ui-action | pending | `dist/contracts/enhancedToolContracts.js:30` |
| `observe_native_ui` | observe-native-ui | pending | `dist/contracts/native/nativeToolContracts.js:64` |
| `capture_native_ui_scenario` | capture-native-ui-scenario | pending | `dist/contracts/native/nativeToolContracts.js:65` |
| `observe_native_calls` | observe-native-calls | pending | `dist/contracts/native/nativeToolContracts.js:66` |
| `inspect_macho` | inspect-macho | pending | `dist/contracts/managed/managedWorkflowExamples.js:236`<br>`dist/contracts/native/nativeToolContracts.js:67` |
| `inspect_signature` | inspect-signature | pending | `dist/contracts/native/nativeToolContracts.js:73` |
| `inspect_plist` | inspect-plist | pending | `dist/contracts/native/nativeToolContracts.js:74` |
| `list_architectures` | list-architectures | pending | `dist/contracts/native/nativeToolContracts.js:77` |
| `demangle_swift` | demangle-swift | pending | `dist/contracts/native/nativeToolContracts.js:78` |
| `inspect_artifact` | inspect-artifact | pending | `dist/contracts/artifactToolContracts.js:61`<br>`dist/contracts/promptContracts.js:100` |
| `extract_artifact` | extract-artifact | pending | `dist/contracts/artifactToolContracts.js:62` |
| `decode_interface_builder` | decode-interface-builder | pending | `dist/contracts/artifactToolContracts.js:63` |
| `inspect_keyed_archive` | inspect-keyed-archive | pending | `dist/contracts/artifactToolContracts.js:72` |
| `inspect_asset_catalog` | inspect-asset-catalog | pending | `dist/contracts/artifactToolContracts.js:73` |
| `trace_dylib_resolution` | trace-dylib-resolution | pending | `dist/contracts/artifactToolContracts.js:74` |
| `inspect_managed_artifact` | inspect-managed-artifact | pending | `dist/contracts/managed/managedToolContracts.js:36` |
| `inspect_managed_members` | inspect-managed-members | pending | `dist/contracts/managed/managedToolContracts.js:37`<br>`dist/contracts/managed/managedWorkflowExamples.js:51` |
| `inspect_managed_native_boundaries` | inspect-managed-native-boundaries | pending | `dist/contracts/managed/managedToolContracts.js:38`<br>`dist/contracts/managed/managedWorkflowExamples.js:193` |
| `compare_managed_members` | compare-managed-members | pending | `dist/contracts/managed/managedWorkflowToolContracts.js:64` |
| `verify_managed_native_boundaries` | verify-managed-native-boundaries | pending | `dist/contracts/managed/managedWorkflowToolContracts.js:66` |
| `import_managed_reconstruction` | import-managed-reconstruction | pending | `dist/contracts/managed/managedWorkflowToolContracts.js:65` |
| `project_managed_application_graph` | project-managed-application-graph | pending | `dist/contracts/managed/managedWorkflowToolContracts.js:67` |
| `inspect_with_objdump` | inspect-with-objdump, list-objdump-architectures | pending | `dist/contracts/reverseEngineeringToolContracts.js:21` |
| `execute_rizin_command` | execute-rizin-command | pending | `dist/contracts/reverseEngineeringToolContracts.js:39` |
| `list_frida_devices` | list-frida-devices | pending | `dist/contracts/fridaToolContracts.js:50` |
| `list_frida_processes` | list-frida-processes | pending | `dist/contracts/fridaToolContracts.js:66` |
| `start_frida_session` | — | pending | `dist/contracts/fridaToolContracts.js:88` |
| `load_frida_script` | — | pending | `dist/contracts/fridaToolContracts.js:117` |
| `resume_frida_session` | — | pending | `dist/contracts/fridaToolContracts.js:147` |
| `unload_frida_script` | — | pending | `dist/contracts/fridaToolContracts.js:161` |
| `frida_session_status` | — | pending | `dist/contracts/fridaToolContracts.js:181` |
| `close_frida_session` | — | pending | `dist/contracts/fridaToolContracts.js:205` |
| `instrument_with_frida` | instrument-with-frida | pending | `dist/contracts/fridaToolContracts.js:219` |
| `list_cutter_sessions` | list-cutter-sessions | pending | `dist/contracts/cutterToolContracts.js:57` |
| `cutter_command` | cutter-command | pending | `dist/contracts/cutterToolContracts.js:66` |
| `start_gdb_session` | debug-with-gdb | pending | `dist/contracts/gdbToolContracts.js:22` |
| `gdb_console` | debug-with-gdb | pending | `dist/contracts/gdbToolContracts.js:40` |
| `gdb_session_status` | — | pending | `dist/contracts/gdbToolContracts.js:60` |
| `close_gdb_session` | debug-with-gdb | pending | `dist/contracts/gdbToolContracts.js:88` |
| `start_rizin_debug_session` | debug-with-rizin | pending | `dist/contracts/rizinDebugToolContracts.js:17` |
| `rizin_debug_command` | debug-with-rizin | pending | `dist/contracts/rizinDebugToolContracts.js:38` |
| `rizin_debug_session_status` | — | pending | `dist/contracts/rizinDebugToolContracts.js:61` |
| `close_rizin_debug_session` | debug-with-rizin | pending | `dist/contracts/rizinDebugToolContracts.js:83` |
| `inspect_packet_capture` | inspect-packet-capture | pending | `dist/contracts/captures/captureToolContracts.js:22` |
| `inspect_packet_fields` | inspect-packet-fields | pending | `dist/contracts/captures/captureToolContracts.js:7` |
| `decode_signal_recording` | decode-signal-recording | pending | `dist/contracts/signals/signalToolContracts.js:22` |
| `inspect_signal_decoders` | inspect-signal-decoders | pending | `dist/contracts/signals/signalToolContracts.js:7` |
| `inspect_android_package` | inspect-android-package | pending | `dist/contracts/android/androidToolContracts.js:9` |
| `search_android_classes` | search-android-classes | pending | `dist/contracts/android/androidToolContracts.js:27` |
| `inspect_android_class` | inspect-android-class | pending | `dist/contracts/android/androidToolContracts.js:41` |
| `inspect_android_method` | inspect-android-method | pending | `dist/contracts/android/androidToolContracts.js:55` |
| `trace_android_references` | trace-android-references | pending | `dist/contracts/android/androidToolContracts.js:73` |
| `inspect_jeb_client` | inspect-jeb-client | pending | `dist/contracts/jeb/jebToolContracts.js:7` |
| `open_jeb_project` | open-jeb-project | pending | `dist/contracts/jeb/jebToolContracts.js:16` |
| `list_jeb_units` | list-jeb-units | pending | `dist/contracts/jeb/jebToolContracts.js:30` |
| `decompile_jeb_item` | decompile-jeb-item | pending | `dist/contracts/jeb/jebToolContracts.js:48` |
| `inspect_binary_layout` | inspect-binary-layout | pending | `dist/contracts/native/binaryDiagnosticsToolContracts.js:27` |
| `inspect_analysis_view` | inspect-analysis-view | pending | `dist/contracts/analysisViewToolContracts.js:9`<br>`dist/contracts/promptContracts.js:67` |
| `inspect_pe_resources` | inspect-pe-resources | implemented-native-tested | `dist/contracts/native/binaryDiagnosticsToolContracts.js:13` |
| `inspect_go_binary` | inspect-go-binary | implemented-native-tested | `dist/contracts/go/goToolContracts.js:7` |
| `inspect_rust_binary` | inspect-rust-binary | implemented-native-tested | `dist/contracts/rust/rustToolContracts.js:7` |
| `compare_wasm_interfaces` | compare-wasm-interfaces | pending | `dist/contracts/wasm/wasmComparisonContracts.js:45` |
| `inspect_wasm_artifact` | inspect-wasm-artifact | pending | `dist/contracts/wasm/wasmToolContracts.js:12` |
| `inspect_evm_interface` | inspect-evm-interface | pending | `dist/contracts/evm/evmToolContracts.js:11` |
| `inspect_sqlite_database` | inspect-sqlite-database | pending | `dist/contracts/sqlite/sqliteToolContracts.js:7` |
| `inspect_recorded_crash` | inspect-recorded-crash | pending | `dist/contracts/native/binaryDiagnosticsToolContracts.js:45` |
| `inspect_firmware_regions` | inspect-firmware-regions | pending | `dist/contracts/firmware/firmwareToolContracts.js:7` |
| `extract_firmware` | extract-firmware | pending | `dist/contracts/firmware/firmwareToolContracts.js:21` |
| `trace_web_module_imports` | trace-web-module-imports | pending | `dist/contracts/webScriptToolContracts.js:31` |
| `trace_web_source_location` | trace-web-source-location | pending | `dist/contracts/webScriptToolContracts.js:9` |
| `observe_web_execution` | observe-web-execution | pending | `dist/contracts/webRuntimeToolContracts.js:8` |
| `inspect_web_event_listeners` | inspect-web-event-listeners | pending | `dist/contracts/webRuntimeToolContracts.js:26` |
| `inspect_web_network_capture` | inspect-web-network-capture | pending | `dist/contracts/analysisViewApiSurfaceExample.js:16`<br>`dist/contracts/webNetworkCaptureToolContracts.js:8` |
| `recover_javascript_sources` | recover-javascript-sources | pending | `dist/contracts/javascript/javascriptRecoveryToolContracts.js:7` |
| `inspect_adb_client` | inspect-adb-client | pending | `dist/contracts/adb/adbToolContracts.js:7` |
| `list_adb_devices` | list-adb-devices | pending | `dist/contracts/adb/adbToolContracts.js:16` |
| `inspect_adb_device` | inspect-adb-device | pending | `dist/contracts/adb/adbToolContracts.js:25` |
| `list_adb_packages` | list-adb-packages | pending | `dist/contracts/adb/adbToolContracts.js:36` |
| `pull_adb_package` | pull-adb-package | pending | `dist/contracts/adb/adbToolContracts.js:50` |
| `read_adb_logcat` | read-adb-logcat | pending | `dist/contracts/adb/adbToolContracts.js:68` |
| `inspect_adb_package` | inspect-adb-package | pending | `dist/contracts/adb/adbToolContracts.js:82` |
| `pull_adb_file` | pull-adb-file | pending | `dist/contracts/adb/adbToolContracts.js:96` |
| `push_adb_file` | push-adb-file | pending | `dist/contracts/adb/adbToolContracts.js:114` |
| `capture_adb_screen` | capture-adb-screen | pending | `dist/contracts/adb/adbToolContracts.js:132` |
| `list_adb_processes` | list-adb-processes | pending | `dist/contracts/adb/adbToolContracts.js:149` |
| `list_adb_directory` | list-adb-directory | pending | `dist/contracts/adb/adbToolContracts.js:158` |
| `list_adb_features` | list-adb-features | pending | `dist/contracts/adb/adbToolContracts.js:175` |
| `list_adb_services` | list-adb-services | pending | `dist/contracts/adb/adbToolContracts.js:184` |
| `inspect_adb_display` | inspect-adb-display | pending | `dist/contracts/adb/adbToolContracts.js:193` |
| `inspect_adb_window` | inspect-adb-window | pending | `dist/contracts/adb/adbToolContracts.js:204` |
| `read_adb_setting` | read-adb-setting | pending | `dist/contracts/adb/adbToolContracts.js:215` |
| `collect_adb_bugreport` | collect-adb-bugreport | pending | `dist/contracts/adb/adbToolContracts.js:233` |
| `resolve_adb_packages` | resolve-adb-packages | pending | `dist/contracts/adb/adbToolContracts.js:250` |
| `install_adb_package` | install-adb-package | pending | `dist/contracts/adb/adbToolContracts.js:264` |
| `uninstall_adb_package` | uninstall-adb-package | pending | `dist/contracts/adb/adbToolContracts.js:286` |
| `start_adb_app` | start-adb-app | pending | `dist/contracts/adb/adbToolContracts.js:300` |
| `start_adb_activity` | start-adb-activity | pending | `dist/contracts/adb/adbToolContracts.js:314` |
| `stop_adb_app` | stop-adb-app | pending | `dist/contracts/adb/adbToolContracts.js:340` |
| `inspect_pcap_client` | inspect-pcap-client | pending | `dist/contracts/pcap/pcapToolContracts.js:9` |
| `inspect_pcap_capture` | inspect-pcap-capture | pending | `dist/contracts/pcap/pcapToolContracts.js:18` |
| `identify_flutter_build` | identify-flutter-build | pending | `dist/contracts/flutter/flutterToolContracts.js:9` |
| `inspect_dart_aot` | inspect-dart-aot | pending | `dist/contracts/flutter/flutterToolContracts.js:23` |
| `inspect_apktool_client` | inspect-apktool-client | pending | `dist/contracts/apktool/apktoolToolContracts.js:7` |
| `decode_android_resources` | decode-android-resources | pending | `dist/contracts/apktool/apktoolToolContracts.js:16` |
| `export_web_scripts` | export-web-scripts | pending | `dist/contracts/webScriptToolContracts.js:52` |
| `list_browser_targets` | list-browser-targets | pending | `dist/contracts/browserToolContracts.js:97` |
| `inspect_web_page` | inspect-web-page | pending | `dist/contracts/browserToolContracts.js:113` |
| `analyze_web_bundle` | analyze-web-bundle | pending | `dist/contracts/browserToolContracts.js:130` |
| `observe_web_session` | observe-web-session | pending | `dist/contracts/browserToolContracts.js:152` |
| `discover_webmcp_tools` | discover-webmcp-tools | pending | `dist/contracts/browserToolContracts.js:170` |
| `compare_web_captures` | compare-web-captures | pending | `dist/contracts/browserToolContracts.js:188` |
| `capture_web_screenshot` | capture-web-screenshot | pending | `dist/contracts/browserToolContracts.js:215` |
| `compare_web_screenshots` | compare-web-screenshots | pending | `dist/contracts/browserToolContracts.js:232` |
| `capture_browser_scenario` | capture-browser-scenario | pending | `dist/contracts/browserScenarioToolContracts.js:22` |
| `inspect_electron_fuses` | inspect-electron-fuses | implemented-native-tested | `dist/contracts/javascript/electronToolContracts.js:121` |
| `list_electron_targets` | list-electron-targets | pending | `dist/contracts/javascript/electronToolContracts.js:30` |
| `inspect_electron_page` | inspect-electron-page | pending | `dist/contracts/javascript/electronToolContracts.js:46`<br>`dist/contracts/javascript/javascriptRuntimeReconciliationExample.js:166` |
| `analyze_javascript_application` | analyze, analyze-javascript-application | pending | `dist/contracts/javascript/electronToolContracts.js:63`<br>`dist/contracts/javascript/javascriptExportShapeComparisonExample.js:232`<br>`dist/contracts/javascript/javascriptRuntimeReconciliationExample.js:110`<br>`dist/contracts/promptContracts.js:55` |
| `reconcile_javascript_runtime` | reconcile-javascript-runtime | pending | `dist/contracts/javascript/electronToolContracts.js:96`<br>`dist/contracts/javascript/javascriptApplicationWorkflowExamples.js:13`<br>`dist/contracts/promptContracts.js:106` |
| `capture_electron_scenario` | capture-electron-scenario | pending | `dist/contracts/javascript/electronToolContracts.js:110` |
| `list_javascript_runtime_targets` | list-javascript-runtime-targets | pending | `dist/contracts/javascript/javascriptRuntimeObservationToolContracts.js:8` |
| `observe_javascript_runtime` | observe-javascript-runtime | pending | `dist/contracts/javascript/javascriptRuntimeObservationToolContracts.js:24` |
| `trace_application_feature` | trace-application-feature | pending | `dist/contracts/applicationToolContracts.js:32`<br>`dist/contracts/promptContracts.js:67` |
| `trace_javascript_semantics` | trace-javascript-semantics | pending | `dist/contracts/applicationToolContracts.js:53` |
| `compare_application_versions` | compare-application-versions | pending | `dist/contracts/applicationToolContracts.js:73`<br>`dist/contracts/promptContracts.js:87` |
| `compare_source_to_bundle` | compare-source-to-bundle | pending | `dist/contracts/applicationToolContracts.js:95` |
| `compare_javascript_export_shapes` | compare-javascript-export-shapes | pending | `dist/contracts/applicationToolContracts.js:109` |
| `build_reconstruction_obligation_ledger` | build-reconstruction-obligation-ledger | pending | `dist/contracts/applicationToolContracts.js:131` |
| `evaluate_reconstruction_coverage` | evaluate-reconstruction-coverage | pending | `dist/contracts/applicationToolContracts.js:160` |
| `project_android_application_graph` | project-android-application-graph | pending | `dist/contracts/applicationToolContracts.js:210` |
| `project_apple_application_graph` | project-apple-application-graph | pending | `dist/contracts/applicationToolContracts.js:224` |
| `project_harmony_application_graph` | project-harmony-application-graph | pending | `dist/contracts/applicationToolContracts.js:242` |
| `open_binary` | — | pending | `dist/contracts/promptContracts.js:55`<br>`dist/contracts/sessionToolContracts.js:40` |
| `close_binary` | — | pending | `dist/contracts/sessionToolContracts.js:41` |
| `binary_session` | capabilities, providers | pending | `dist/contracts/sessionToolContracts.js:42` |
| `export_evidence_bundle` | evidence-export | pending | `dist/contracts/sessionToolContracts.js:43`<br>`dist/contracts/toolEffects.js:710` |
| `import_evidence_bundle` | evidence-import | pending | `dist/contracts/sessionToolContracts.js:44` |
| `get_evidence_bundle` | — | pending | `dist/contracts/sessionToolContracts.js:58` |
| `capture_process_scenario` | capture-process | pending | `dist/contracts/investigationExamples.js:37`<br>`dist/contracts/promptContracts.js:189`<br>`dist/contracts/sessionToolContracts.js:45`<br>`dist/contracts/unknownContractExamples.js:12` |
| `compare_process_captures` | compare-process-captures | pending | `dist/contracts/investigationExamples.js:53`<br>`dist/contracts/promptContracts.js:120`<br>`dist/contracts/sessionToolContracts.js:46` |
| `compare_artifacts` | — | pending | `dist/contracts/promptContracts.js:112`<br>`dist/contracts/sessionToolContracts.js:47` |
| `compare_functions` | — | pending | `dist/contracts/investigationExamples.js:15`<br>`dist/contracts/promptContracts.js:116`<br>`dist/contracts/sessionToolContracts.js:48` |
| `compare_bundles` | compare | pending | `dist/contracts/sessionToolContracts.js:49` |
| `find_changed_behavior` | — | pending | `dist/contracts/promptContracts.js:120`<br>`dist/contracts/sessionToolContracts.js:50` |
| `build_call_path` | — | pending | `dist/contracts/promptContracts.js:185`<br>`dist/contracts/sessionToolContracts.js:51` |
| `correlate_static_and_runtime` | — | pending | `dist/contracts/promptContracts.js:189`<br>`dist/contracts/sessionToolContracts.js:52` |
| `verify_reconstruction` | — | pending | `dist/contracts/promptContracts.js:130`<br>`dist/contracts/sessionToolContracts.js:53` |
| `list_unknowns` | — | pending | `dist/contracts/promptContracts.js:153`<br>`dist/contracts/sessionToolContracts.js:54` |
| `record_unknown` | — | pending | `dist/contracts/promptContracts.js:81`<br>`dist/contracts/sessionToolContracts.js:55`<br>`dist/contracts/toolEffects.js:711` |
| `update_unknown` | — | pending | `dist/contracts/promptContracts.js:218`<br>`dist/contracts/sessionToolContracts.js:56` |
| `verify_unknown_resolution` | — | pending | `dist/contracts/promptContracts.js:214`<br>`dist/contracts/sessionToolContracts.js:57` |
| `get_navigation_context` | — | pending | `dist/contracts/sessionToolContracts.js:59` |
| `inspect_address_context` | — | pending | `dist/contracts/sessionToolContracts.js:60` |

## CLI 命令

| 命令（别名） | MCP related operations | 原生状态 | DSH 原生操作 | 注册来源（包内路径） |
|---|---|---|---|---|
| `address-to-file-offset` | address_to_file_offset | pending | — | `dist/cli/coreNativeCommands.js:65` |
| `analyze` | binary_overview, analyze_javascript_application | pending | — | `dist/cli/coreBinaryCommands.js:47` |
| `analyze-javascript-application` | analyze_javascript_application | pending | — | `dist/cli/electronCommands.js:142` |
| `analyze-web-bundle` | analyze_web_bundle | pending | — | `dist/cli/browserCommands.js:78` |
| `annotate-native-function` | annotate_native_function | pending | — | `dist/cli/coreNativeCommands.js:270` |
| `build-reconstruction-obligation-ledger` | build_reconstruction_obligation_ledger | pending | — | `dist/cli/applicationCommands.js:123` |
| `capabilities` | binary_session | pending | — | `dist/cli/utilityCommands.js:111` |
| `capture-adb-screen` | capture_adb_screen | pending | — | `dist/cli/adbCommands.js:150` |
| `capture-browser-scenario` | capture_browser_scenario | pending | — | `dist/cliBrowserScenarioCommands.js:17` |
| `capture-electron-scenario` | capture_electron_scenario | pending | — | `dist/cli/electronCommands.js:51` |
| `capture-native-ui-scenario` | capture_native_ui_scenario | pending | — | `dist/cli/utilityCommands.js:73` |
| `capture-process` | capture_process_scenario | pending | — | `dist/cli/processCommands.js:8` |
| `capture-web-screenshot` | capture_web_screenshot | pending | — | `dist/cli/browserAdvancedCommands.js:104` |
| `collect-adb-bugreport` | collect_adb_bugreport | pending | — | `dist/cli/adbCommands.js:218` |
| `compare` (compare-bundles) | compare_bundles | implemented-native-tested | compare_evidence_bundle_files | `dist/cliEvidenceCommands.js:32` |
| `compare-application-versions` | compare_application_versions | pending | — | `dist/cli/applicationCommands.js:45` |
| `compare-javascript-export-shapes` | compare_javascript_export_shapes | pending | — | `dist/cli/applicationCommands.js:67` |
| `compare-managed-members` | compare_managed_members | pending | — | `dist/cli/managedCommands.js:60` |
| `compare-process-captures` | compare_process_captures | pending | — | `dist/cli/processCommands.js:13` |
| `compare-source-to-bundle` | compare_source_to_bundle | pending | — | `dist/cli/applicationCommands.js:56` |
| `compare-wasm-interfaces` | compare_wasm_interfaces | pending | — | `dist/cli/wasmCommands.js:12` |
| `compare-web-captures` | compare_web_captures | pending | — | `dist/cli/browserAdvancedCommands.js:59` |
| `compare-web-screenshots` | compare_web_screenshots | pending | — | `dist/cli/browserAdvancedCommands.js:131` |
| `cutter-command` | cutter_command | pending | — | `dist/cli/cutterCommands.js:16` |
| `debug-with-gdb` | start_gdb_session, gdb_console, close_gdb_session | pending | — | `dist/cli/reverseEngineeringCommands.js:128` |
| `debug-with-rizin` | start_rizin_debug_session, rizin_debug_command, close_rizin_debug_session | pending | — | `dist/cli/reverseEngineeringCommands.js:205` |
| `decode-android-resources` | decode_android_resources | pending | — | `dist/cli/apktoolCommands.js:30` |
| `decode-interface-builder` | decode_interface_builder | pending | — | `dist/cli/artifactCommands.js:91` |
| `decode-signal-recording` | decode_signal_recording | pending | — | `dist/cli/signalCommands.js:38` |
| `decompile` | procedure_pseudo_code | pending | — | `dist/cli/coreBinaryCommands.js:102` |
| `decompile-jeb-item` | decompile_jeb_item | pending | — | `dist/cli/jebCommands.js:73` |
| `demangle-swift` | demangle_swift | pending | — | `dist/cli/utilityCommands.js:147` |
| `discover-webmcp-tools` | discover_webmcp_tools | pending | — | `dist/cli/browserAdvancedCommands.js:25` |
| `doctor` | 无直接对应 | pending | — | `dist/cli/setupCommands.js:66` |
| `evaluate-reconstruction-coverage` | evaluate_reconstruction_coverage | pending | — | `dist/cli/applicationCommands.js:137` |
| `evidence-export` | export_evidence_bundle | implemented-native-tested | export_evidence_bundle_file | `dist/cliEvidenceCommands.js:18` |
| `evidence-import` | import_evidence_bundle | implemented-native-tested | validate_evidence_bundle_file | `dist/cliEvidenceCommands.js:8` |
| `execute-rizin-command` | execute_rizin_command | pending | — | `dist/cli/reverseEngineeringCommands.js:114` |
| `export-web-scripts` | export_web_scripts | pending | — | `dist/cli/webScriptCommands.js:12` |
| `extract-artifact` | extract_artifact | pending | — | `dist/cli/artifactCommands.js:127` |
| `extract-firmware` | extract_firmware | pending | — | `dist/cli/firmwareCommands.js:33` |
| `function` | analyze_function | pending | — | `dist/cli/coreBinaryCommands.js:218` |
| `identify-flutter-build` | identify_flutter_build | pending | — | `dist/cli/flutterCommands.js:13` |
| `import-managed-reconstruction` | import_managed_reconstruction | pending | — | `dist/cli/managedCommands.js:97` |
| `import-reference-source` | 无直接对应 | pending | — | `dist/cli/utilityCommands.js:157` |
| `inspect` | binary_overview | pending | — | `dist/cli/coreBinaryCommands.js:92` |
| `inspect-adb-client` | inspect_adb_client | pending | — | `dist/cli/adbCommands.js:28` |
| `inspect-adb-device` | inspect_adb_device | pending | — | `dist/cli/adbCommands.js:38` |
| `inspect-adb-display` | inspect_adb_display | pending | — | `dist/cli/adbCommands.js:193` |
| `inspect-adb-package` | inspect_adb_package | pending | — | `dist/cli/adbCommands.js:104` |
| `inspect-adb-window` | inspect_adb_window | pending | — | `dist/cli/adbCommands.js:198` |
| `inspect-analysis-view` | inspect_analysis_view | pending | — | `dist/cli/analysisViewCommands.js:50` |
| `inspect-android-class` | inspect_android_class | pending | — | `dist/cli/androidCommands.js:42` |
| `inspect-android-method` | inspect_android_method | pending | — | `dist/cli/androidCommands.js:50` |
| `inspect-android-package` | inspect_android_package | pending | — | `dist/cli/androidCommands.js:27` |
| `inspect-apktool-client` | inspect_apktool_client | pending | — | `dist/cli/apktoolCommands.js:25` |
| `inspect-artifact` | inspect_artifact | pending | — | `dist/cli/artifactCommands.js:145` |
| `inspect-asset-catalog` | inspect_asset_catalog | pending | — | `dist/cli/artifactCommands.js:69` |
| `inspect-binary-layout` | inspect_binary_layout | pending | — | `dist/cli/binaryDiagnosticsCommands.js:29` |
| `inspect-dart-aot` | inspect_dart_aot | pending | — | `dist/cli/flutterCommands.js:22` |
| `inspect-electron-fuses` | inspect_electron_fuses | implemented-native-tested | inspect_electron_fuses | `dist/cli/electronCommands.js:25` |
| `inspect-electron-page` | inspect_electron_page | pending | — | `dist/cli/electronCommands.js:118` |
| `inspect-evidence-bundle` | 无直接对应 | implemented-native-tested | inspect_evidence_bundle | `dist/cli/analysisViewCommands.js:15` |
| `inspect-evm-interface` | inspect_evm_interface | pending | — | `dist/composition/evm.js:14` |
| `inspect-firmware-regions` | inspect_firmware_regions | pending | — | `dist/cli/firmwareCommands.js:26` |
| `inspect-go-binary` | inspect_go_binary | implemented-native-tested | inspect_go_binary | `dist/cli/goCommands.js:10` |
| `inspect-jeb-client` | inspect_jeb_client | pending | — | `dist/cli/jebCommands.js:24` |
| `inspect-keyed-archive` | inspect_keyed_archive | pending | — | `dist/cli/artifactCommands.js:11` |
| `inspect-macho` | inspect_macho | pending | — | `dist/cli/utilityCommands.js:124` |
| `inspect-managed-artifact` | inspect_managed_artifact | pending | — | `dist/cli/managedCommands.js:26` |
| `inspect-managed-members` | inspect_managed_members | pending | — | `dist/cli/managedCommands.js:35` |
| `inspect-managed-native-boundaries` | inspect_managed_native_boundaries | pending | — | `dist/cli/managedCommands.js:47` |
| `inspect-native-api` | inspect_native_api | pending | — | `dist/cli/coreNativeCommands.js:252` |
| `inspect-native-data-type` | inspect_native_data_type | pending | — | `dist/cli/coreNativeCommands.js:146` |
| `inspect-native-dispatch-metadata` | inspect_native_dispatch_metadata | pending | — | `dist/cli/coreNativeCommands.js:186` |
| `inspect-native-instruction` | inspect_native_instruction | pending | — | `dist/cli/coreNativeCommands.js:164` |
| `inspect-native-load-image` | inspect_native_load_image | pending | — | `dist/cli/coreNativeCommands.js:40` |
| `inspect-packet-capture` | inspect_packet_capture | pending | — | `dist/cli/captureCommands.js:38` |
| `inspect-packet-fields` | inspect_packet_fields | pending | — | `dist/cli/captureCommands.js:11` |
| `inspect-pcap-capture` | inspect_pcap_capture | pending | — | `dist/cli/pcapCommands.js:35` |
| `inspect-pcap-client` | inspect_pcap_client | pending | — | `dist/cli/pcapCommands.js:30` |
| `inspect-pe-resources` | inspect_pe_resources | implemented-native-tested | inspect_pe_resources | `dist/cli/binaryDiagnosticsCommands.js:12` |
| `inspect-plist` | inspect_plist | pending | — | `dist/cli/utilityCommands.js:134` |
| `inspect-recorded-crash` | inspect_recorded_crash | pending | — | `dist/cli/binaryDiagnosticsCommands.js:40` |
| `inspect-rust-binary` | inspect_rust_binary | implemented-native-tested | inspect_rust_binary | `dist/cli/rustCommands.js:11` |
| `inspect-signal-decoders` | inspect_signal_decoders | pending | — | `dist/cli/signalCommands.js:11` |
| `inspect-signature` | inspect_signature | pending | — | `dist/cli/utilityCommands.js:125` |
| `inspect-sqlite-database` | inspect_sqlite_database | pending | — | `dist/cli/sqliteCommands.js:13` |
| `inspect-wasm-artifact` | inspect_wasm_artifact | pending | — | `dist/composition/wasm.js:14` |
| `inspect-web-event-listeners` | inspect_web_event_listeners | pending | — | `dist/cli/webRuntimeCommands.js:38` |
| `inspect-web-network-capture` | inspect_web_network_capture | pending | — | `dist/cli/webNetworkCaptureCommands.js:11` |
| `inspect-web-page` | inspect_web_page | pending | — | `dist/cli/browserCommands.js:43` |
| `inspect-with-objdump` | inspect_with_objdump | pending | — | `dist/cli/reverseEngineeringCommands.js:71` |
| `install-adb-package` | install_adb_package | pending | — | `dist/cli/adbCommands.js:243` |
| `instructions` | read_function_instructions | pending | — | `dist/cli/coreBinaryCommands.js:247` |
| `instrument-with-frida` | instrument_with_frida | pending | — | `dist/cli/fridaCommands.js:116` |
| `list-adb-devices` | list_adb_devices | pending | — | `dist/cli/adbCommands.js:33` |
| `list-adb-directory` | list_adb_directory | pending | — | `dist/cli/adbCommands.js:169` |
| `list-adb-features` | list_adb_features | pending | — | `dist/cli/adbCommands.js:183` |
| `list-adb-packages` | list_adb_packages | pending | — | `dist/cli/adbCommands.js:43` |
| `list-adb-processes` | list_adb_processes | pending | — | `dist/cli/adbCommands.js:164` |
| `list-adb-services` | list_adb_services | pending | — | `dist/cli/adbCommands.js:188` |
| `list-architectures` | list_architectures | pending | — | `dist/cli/utilityCommands.js:126` |
| `list-browser-targets` | list_browser_targets | pending | — | `dist/cli/browserCommands.js:20` |
| `list-cutter-sessions` | list_cutter_sessions | pending | — | `dist/cli/cutterCommands.js:11` |
| `list-electron-targets` | list_electron_targets | pending | — | `dist/cli/electronCommands.js:99` |
| `list-frida-devices` | list_frida_devices | pending | — | `dist/cli/fridaCommands.js:75` |
| `list-frida-processes` | list_frida_processes | pending | — | `dist/cli/fridaCommands.js:89` |
| `list-javascript-runtime-targets` | list_javascript_runtime_targets | pending | — | `dist/cliJavaScriptRuntimeCommands.js:23` |
| `list-jeb-units` | list_jeb_units | pending | — | `dist/cli/jebCommands.js:38` |
| `list-objdump-architectures` | inspect_with_objdump | pending | — | `dist/cli/reverseEngineeringCommands.js:104` |
| `observe-javascript-runtime` | observe_javascript_runtime | pending | — | `dist/cliJavaScriptRuntimeCommands.js:40` |
| `observe-native-calls` | observe_native_calls | pending | — | `dist/cli/nativeCallCommands.js:12` |
| `observe-native-ui` | observe_native_ui | pending | — | `dist/cli/utilityCommands.js:66` |
| `observe-web-execution` | observe_web_execution | pending | — | `dist/cli/webRuntimeCommands.js:16` |
| `observe-web-session` | observe_web_session | pending | — | `dist/cli/browserCommands.js:115` |
| `open-jeb-project` | open_jeb_project | pending | — | `dist/cli/jebCommands.js:29` |
| `project-android-application-graph` | project_android_application_graph | pending | — | `dist/cli/applicationCommands.js:80` |
| `project-apple-application-graph` | project_apple_application_graph | pending | — | `dist/cli/applicationCommands.js:94` |
| `project-harmony-application-graph` | project_harmony_application_graph | pending | — | `dist/cli/applicationCommands.js:108` |
| `project-managed-application-graph` | project_managed_application_graph | pending | — | `dist/cli/managedProjectGraphCommand.js:9` |
| `providers` | binary_session | pending | — | `dist/cli/utilityCommands.js:112` |
| `pull-adb-file` | pull_adb_file | pending | — | `dist/cli/adbCommands.js:112` |
| `pull-adb-package` | pull_adb_package | pending | — | `dist/cli/adbCommands.js:57` |
| `push-adb-file` | push_adb_file | pending | — | `dist/cli/adbCommands.js:130` |
| `read-adb-logcat` | read_adb_logcat | pending | — | `dist/cli/adbCommands.js:75` |
| `read-adb-setting` | read_adb_setting | pending | — | `dist/cli/adbCommands.js:203` |
| `read-bytes` | read_bytes | pending | — | `dist/cli/coreNativeCommands.js:48` |
| `reconcile-javascript-runtime` | reconcile_javascript_runtime | pending | — | `dist/cli/electronCommands.js:77` |
| `recover-javascript-sources` | recover_javascript_sources | pending | — | `dist/cli/javascriptRecoveryCommands.js:11` |
| `resolve-adb-packages` | resolve_adb_packages | pending | — | `dist/cli/adbCommands.js:232` |
| `resolve-native-call-targets` | resolve_native_call_targets | pending | — | `dist/cli/coreNativeCommands.js:165` |
| `search` | search_strings, search_procedures | pending | — | `dist/cli/coreBinaryCommands.js:276` |
| `search-android-classes` | search_android_classes | pending | — | `dist/cli/androidCommands.js:32` |
| `search-bytes` | search_bytes | pending | — | `dist/cli/coreNativeCommands.js:8` |
| `setup` | 无直接对应 | pending | — | `dist/cli/setupCommands.js:24` |
| `start-adb-activity` | start_adb_activity | pending | — | `dist/cli/adbCommands.js:283` |
| `start-adb-app` | start_adb_app | pending | — | `dist/cli/adbCommands.js:272` |
| `stop-adb-app` | stop_adb_app | pending | — | `dist/cli/adbCommands.js:326` |
| `trace` | trace_feature | pending | — | `dist/cli/coreBinaryCommands.js:188` |
| `trace-android-references` | trace_android_references | pending | — | `dist/cli/androidCommands.js:74` |
| `trace-application-feature` | trace_application_feature | pending | — | `dist/cli/applicationCommands.js:23` |
| `trace-dylib-resolution` | trace_dylib_resolution | pending | — | `dist/cli/artifactCommands.js:45` |
| `trace-javascript-semantics` | trace_javascript_semantics | pending | — | `dist/cli/applicationCommands.js:34` |
| `trace-native-ui-action` | trace_native_ui_action | pending | — | `dist/cli/coreNativeCommands.js:210` |
| `trace-native-values` | trace_native_values | pending | — | `dist/cli/coreNativeCommands.js:76` |
| `trace-web-module-imports` | trace_web_module_imports | pending | — | `dist/cli/webModuleCommands.js:12` |
| `trace-web-source-location` | trace_web_source_location | pending | — | `dist/cli/webSourceLocationCommands.js:10` |
| `uninstall` | 无直接对应 | pending | — | `dist/cli/setupCommands.js:93` |
| `uninstall-adb-package` | uninstall_adb_package | pending | — | `dist/cli/adbCommands.js:261` |
| `update` | 无直接对应 | pending | — | `dist/cli/setupCommands.js:106` |
| `verify-managed-native-boundaries` | verify_managed_native_boundaries | pending | — | `dist/cli/managedCommands.js:114` |
| `xrefs` | xrefs | pending | — | `dist/cli/coreBinaryCommands.js:163` |
