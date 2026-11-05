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
            values.update(SWIFT_ACTIVE_COMPILATION_CONDITIONS="DEBUG", ONLY_ACTIVE_ARCH="YES")
        configurations.append(obj(
            name + mode, "XCBuildConfiguration", name=quote(mode),
            baseConfigurationReference=uid("config"),
            buildSettings="{" + "".join(f"{k} = {quote(v)};" for k, v in values.items()) + "}",
        ))
    return obj(name + "configs", "XCConfigurationList", buildConfigurations=array(configurations),
               defaultConfigurationIsVisible="0", defaultConfigurationName=quote("Release"))


obj("config", "PBXFileReference", lastKnownFileType=quote("text.xcconfig"),
    path=quote("Config.xcconfig"), sourceTree=quote("<group>"))
references, sources = [], []
for path in sorted((ROOT / "Kitty").rglob("*.swift")):
    relative = path.relative_to(ROOT).as_posix()
    reference = obj(relative, "PBXFileReference", lastKnownFileType=quote("sourcecode.swift"),
                    path=quote(relative), sourceTree=quote("SOURCE_ROOT"))
    references.append(reference)
    sources.append(obj(relative + "build", "PBXBuildFile", fileRef=reference))

group = obj("appgroup", "PBXGroup", children=array(references), name=quote("Kitty"),
            sourceTree=quote("<group>"))
phases = [obj("sources", "PBXSourcesBuildPhase", buildActionMask="2147483647",
              files=array(sources), runOnlyForDeploymentPostprocessing="0"),
          obj("resources", "PBXResourcesBuildPhase", buildActionMask="2147483647",
              files="()", runOnlyForDeploymentPostprocessing="0"),
          obj("frameworks", "PBXFrameworksBuildPhase", buildActionMask="2147483647",
              files="()", runOnlyForDeploymentPostprocessing="0")]
product = obj("product", "PBXFileReference", explicitFileType=quote("wrapper.application"),
              includeInIndex="0", path=quote("Kitty.app"), sourceTree=quote("BUILT_PRODUCTS_DIR"))
settings = {
    "PRODUCT_NAME": "Kitty", "PRODUCT_BUNDLE_IDENTIFIER": "com.ethdawg.kitty",
    "SWIFT_VERSION": "5.0", "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
    "TARGETED_DEVICE_FAMILY": "1,2", "SDKROOT": "iphoneos", "CODE_SIGN_STYLE": "Automatic",
    "GENERATE_INFOPLIST_FILE": "NO", "INFOPLIST_FILE": "Kitty/Info.plist",
    "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
}
target = obj("target", "PBXNativeTarget", buildConfigurationList=configs("Kitty", settings),
             buildPhases=array(phases), buildRules="()", dependencies="()", name=quote("Kitty"),
             productName=quote("Kitty"), productReference=product,
             productType=quote("com.apple.product-type.application"))
products = obj("products", "PBXGroup", children=array([product]), name=quote("Products"),
               sourceTree=quote("<group>"))
main = obj("main", "PBXGroup", children=array([group, uid("config"), products]), sourceTree=quote("<group>"))
project = obj("project", "PBXProject", attributes="{ BuildIndependentTargetsInParallel = YES; }",
              buildConfigurationList=configs("project", {"CLANG_ENABLE_MODULES": "YES"}),
              compatibilityVersion=quote("Xcode 14.0"), developmentRegion=quote("en"),
              hasScannedForEncodings="0", knownRegions="(en,Base)", mainGroup=main,
              productRefGroup=products, projectDirPath=quote(""), projectRoot=quote(""),
              targets=array([target]))
destination = ROOT / "Kitty.xcodeproj"
destination.mkdir(exist_ok=True)
(destination / "project.pbxproj").write_text(
    "// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n"
    + "\n".join(f"{key} = {value};" for key, value in OBJECTS.items())
    + f"\n}}; rootObject = {project}; }}\n"
)
reference = (f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" '
             'BuildableName="Kitty.app" BlueprintName="Kitty" ReferencedContainer="container:Kitty.xcodeproj"/>')
schemes = destination / "xcshareddata" / "xcschemes"
schemes.mkdir(parents=True, exist_ok=True)
(schemes / "Kitty.xcscheme").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
    <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry>
  </BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" shouldUseLaunchSchemeArgsEnv="YES"><Testables/></TestAction>
  <LaunchAction buildConfiguration="Debug" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES">
    <BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable>
  </LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print("Generated ios/Kitty.xcodeproj")
