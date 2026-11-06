"""Generate the small native host project deterministically, without dependencies."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OBJECTS = {}


def uid(key):
    return hashlib.sha1(key.encode()).hexdigest()[:24].upper()


def quote(value):
    return json.dumps(str(value))


def array(values):
    return "(" + ",".join(values) + ")"


def obj(key, isa, **fields):
    identifier = uid(key)
    OBJECTS[identifier] = "{ isa = " + isa + "; " + " ".join(
        f"{name} = {value};" for name, value in fields.items()
    ) + " }"
    return identifier


def configs(name, settings):
    configurations = []
    for mode in ("Debug", "Release"):
        values = {**settings, "SWIFT_OPTIMIZATION_LEVEL": "-Onone" if mode == "Debug" else "-O"}
        if mode == "Debug":
            values.update(SWIFT_ACTIVE_COMPILATION_CONDITIONS="DEBUG", ONLY_ACTIVE_ARCH="YES", ENABLE_TESTABILITY="YES")
        configurations.append(obj(
            name + mode, "XCBuildConfiguration", name=quote(mode),
            baseConfigurationReference=uid("config"),
            buildSettings="{" + "".join(f"{k} = {quote(v)};" for k, v in values.items()) + "}",
        ))
    return obj(name + "configs", "XCConfigurationList", buildConfigurations=array(configurations),
               defaultConfigurationIsVisible="0", defaultConfigurationName=quote("Release"))


obj("config", "PBXFileReference", lastKnownFileType=quote("text.xcconfig"),
    path=quote("Config.xcconfig"), sourceTree=quote("<group>"))
groups, product_refs, targets = [], [], []
for name in ("Kitty", "KittyTests", "KittyUITests"):
    is_app = name == "Kitty"
    references, sources, resources = [], [], []
    paths = sorted((ROOT / name).rglob("*.swift"))
    if is_app:
        # Declared even before generation: a missing build input must fail the build.
        paths += [ROOT / "Kitty/Resources/kitty-native.html", ROOT / "Kitty/Resources/kitty-period-bank.js",
                  ROOT / "../src/core/import.js", ROOT / "../fixtures/Kitty-2027-01-card-proof.csv", ROOT / "Kitty/Assets.xcassets",
                  ROOT / "Kitty/PrivacyInfo.xcprivacy"]
    for path in paths:
        relative = path.relative_to(ROOT).as_posix()
        file_type = {".swift": "sourcecode.swift", ".html": "text.html", ".js": "sourcecode.javascript",
                     ".csv": "text", ".xcassets": "folder.assetcatalog", ".xcprivacy": "text.xml"}[path.suffix]
        reference = obj(relative, "PBXFileReference", lastKnownFileType=quote(file_type),
                        path=quote(relative), sourceTree=quote("SOURCE_ROOT"))
        references.append(reference)
        (sources if path.suffix == ".swift" else resources).append(obj(relative + "build", "PBXBuildFile", fileRef=reference))
    groups.append(obj(name + "group", "PBXGroup", children=array(references), name=quote(name), sourceTree=quote("<group>")))
    phases = [obj(name + "sources", "PBXSourcesBuildPhase", buildActionMask="2147483647",
                  files=array(sources), runOnlyForDeploymentPostprocessing="0"),
              obj(name + "resources", "PBXResourcesBuildPhase", buildActionMask="2147483647",
                  files=array(resources), runOnlyForDeploymentPostprocessing="0"),
              obj(name + "frameworks", "PBXFrameworksBuildPhase", buildActionMask="2147483647",
                  files="()", runOnlyForDeploymentPostprocessing="0")]
    product = obj(name + "product", "PBXFileReference",
                  explicitFileType=quote("wrapper.application" if is_app else "wrapper.cfbundle"),
                  includeInIndex="0", path=quote(name + (".app" if is_app else ".xctest")), sourceTree=quote("BUILT_PRODUCTS_DIR"))
    product_refs.append(product)
    settings = {
        "PRODUCT_NAME": name, "PRODUCT_BUNDLE_IDENTIFIER": "com.ethdawg.kitty" + ("" if is_app else ".tests"),
        "SWIFT_VERSION": "5.0", "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
        "TARGETED_DEVICE_FAMILY": "1,2", "SDKROOT": "iphoneos", "CODE_SIGN_STYLE": "Automatic",
        "GENERATE_INFOPLIST_FILE": "NO" if is_app else "YES", "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
    }
    if is_app:
        settings.update(INFOPLIST_FILE="Kitty/Info.plist", ASSETCATALOG_COMPILER_APPICON_NAME="AppIcon",
                        ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES="KittyAlternate",
                        ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME="KittyTint")
    elif name == "KittyTests":
        settings.update(TEST_HOST="$(BUILT_PRODUCTS_DIR)/Kitty.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Kitty",
                        BUNDLE_LOADER="$(TEST_HOST)", TEST_TARGET_NAME="Kitty")
    else:
        settings.update(TEST_TARGET_NAME="Kitty")
    dependencies = [] if is_app else [obj(name + "dependency", "PBXTargetDependency", target=uid("Kittytarget"))]
    targets.append(obj(name + "target", "PBXNativeTarget", buildConfigurationList=configs(name, settings),
                       buildPhases=array(phases), buildRules="()", dependencies=array(dependencies), name=quote(name),
                       productName=quote(name), productReference=product,
                       productType=quote("com.apple.product-type." + ("application" if is_app else "bundle.unit-test" if name == "KittyTests" else "bundle.ui-testing"))))
products = obj("products", "PBXGroup", children=array(product_refs), name=quote("Products"),
               sourceTree=quote("<group>"))
main = obj("main", "PBXGroup", children=array(groups + [uid("config"), products]), sourceTree=quote("<group>"))
project = obj("project", "PBXProject", attributes="{ BuildIndependentTargetsInParallel = YES; }",
              buildConfigurationList=configs("project", {"CLANG_ENABLE_MODULES": "YES"}),
              compatibilityVersion=quote("Xcode 14.0"), developmentRegion=quote("en"),
              hasScannedForEncodings="0", knownRegions="(en,Base)", mainGroup=main,
              productRefGroup=products, projectDirPath=quote(""), projectRoot=quote(""),
              targets=array(targets))
destination = ROOT / "Kitty.xcodeproj"
destination.mkdir(exist_ok=True)
(destination / "project.pbxproj").write_text(
    "// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n"
    + "\n".join(f"{key} = {value};" for key, value in OBJECTS.items())
    + f"\n}}; rootObject = {project}; }}\n"
)
reference = (f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid("Kittytarget")}" '
             'BuildableName="Kitty.app" BlueprintName="Kitty" ReferencedContainer="container:Kitty.xcodeproj"/>')
test_reference = (f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid("KittyTeststarget")}" '
                  'BuildableName="KittyTests.xctest" BlueprintName="KittyTests" ReferencedContainer="container:Kitty.xcodeproj"/>')
ui_test_reference = (f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid("KittyUITeststarget")}" '
                     'BuildableName="KittyUITests.xctest" BlueprintName="KittyUITests" ReferencedContainer="container:Kitty.xcodeproj"/>')
schemes = destination / "xcshareddata" / "xcschemes"
schemes.mkdir(parents=True, exist_ok=True)
(schemes / "Kitty.xcscheme").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
    <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry>
  </BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO" parallelizable="NO">{test_reference}</TestableReference><TestableReference skipped="NO" parallelizable="NO">{ui_test_reference}</TestableReference></Testables></TestAction>
  <LaunchAction buildConfiguration="Debug" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES">
    <BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable>
  </LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print("Generated ios/Kitty.xcodeproj")
