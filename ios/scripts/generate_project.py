"""Deterministic Xcode project; no third-party project generator required."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
def uid(s): return hashlib.sha1(s.encode()).hexdigest()[:24].upper()
def q(v): return json.dumps(str(v))
objects={}
def obj(object_key,isa,**fields):
 i=uid(object_key);objects[i]='{ isa = '+isa+'; '+ ' '.join(k+' = '+v+';' for k,v in fields.items())+' }';return i
def arr(xs):return '('+','.join(xs)+')'
def configs(name,settings):
 ids=[]
 for config in ['Debug','Release']:
  sets={**settings,'SWIFT_OPTIMIZATION_LEVEL':'-Onone' if config=='Debug' else '-O','DEBUG_INFORMATION_FORMAT':'dwarf' if config=='Debug' else 'dwarf-with-dsym'}
  if config=='Debug':sets.update({'SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG','ENABLE_TESTABILITY':'YES','ONLY_ACTIVE_ARCH':'YES'})
  ids.append(obj(name+config,'XCBuildConfiguration',name=q(config),baseConfigurationReference=uid('config'),buildSettings='{'+''.join(k+' = '+q(v)+';' for k,v in sets.items())+'}'))
 return obj(name+'configs','XCConfigurationList',buildConfigurations=arr(ids),defaultConfigurationIsVisible='0',defaultConfigurationName=q('Release'))
obj('config','PBXFileReference',lastKnownFileType=q('text.xcconfig'),path=q('Config.xcconfig'),sourceTree=q('<group>'))
products=[];groups=[];targets=[]
for name,folder,producttype,ext in [('Kitty','Kitty','application','app'),('KittyTests','KittyTests','bundle.unit-test','xctest'),('KittyUITests','KittyUITests','bundle.ui-testing','xctest')]:
 sources=[];resources=[];refs=[]
 paths=list((ROOT/folder).rglob('*.swift'))
 if name=='Kitty': paths += list((ROOT/folder/'Resources').glob('*'))+[ROOT/folder/'Assets.xcassets',ROOT/folder/'PrivacyInfo.xcprivacy']
 if name in ['KittyTests','KittyUITests']: paths += list((ROOT/'TestFixtures').glob('*'))
 for p in sorted(paths):
  rel=p.relative_to(ROOT).as_posix();typ={'.swift':'sourcecode.swift','.js':'sourcecode.javascript','.json':'text.json','.csv':'text','.xcprivacy':'text.xml','.xcassets':'folder.assetcatalog'}.get(p.suffix,'text')
  ref=obj(name+rel,'PBXFileReference',lastKnownFileType=q(typ),path=q(rel),sourceTree=q('SOURCE_ROOT'));refs.append(ref)
  build=obj(name+rel+'build','PBXBuildFile',fileRef=ref)
  (sources if p.suffix=='.swift' else resources).append(build)
 group=obj(name+'group','PBXGroup',children=arr(refs),name=q(name),sourceTree=q('<group>'));groups.append(group)
 phases=[obj(name+'sources','PBXSourcesBuildPhase',buildActionMask='2147483647',files=arr(sources),runOnlyForDeploymentPostprocessing='0'),obj(name+'resources','PBXResourcesBuildPhase',buildActionMask='2147483647',files=arr(resources),runOnlyForDeploymentPostprocessing='0'),obj(name+'frameworks','PBXFrameworksBuildPhase',buildActionMask='2147483647',files='()',runOnlyForDeploymentPostprocessing='0')]
 product=obj(name+'product','PBXFileReference',explicitFileType=q('wrapper.application' if ext=='app' else 'wrapper.cfbundle'),includeInIndex='0',path=q(name+'.'+ext),sourceTree=q('BUILT_PRODUCTS_DIR'));products.append(product)
 settings={'PRODUCT_NAME':name,'PRODUCT_BUNDLE_IDENTIFIER':'com.ethdawg.kitty'+('' if name=='Kitty' else '.'+name),'SWIFT_VERSION':'5.0','IPHONEOS_DEPLOYMENT_TARGET':'17.0','TARGETED_DEVICE_FAMILY':'1,2','SDKROOT':'iphoneos','CODE_SIGN_STYLE':'Automatic','GENERATE_INFOPLIST_FILE':'YES','ENABLE_USER_SCRIPT_SANDBOXING':'YES'}
 deps=[]
 if name=='Kitty': settings.update({'INFOPLIST_FILE':'Kitty/Info.plist','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','ENABLE_PREVIEWS':'YES','GENERATE_INFOPLIST_FILE':'NO'})
 else:
  deps=[obj(name+'dependency','PBXTargetDependency',target=uid('Kittytarget'))]
  settings['TEST_TARGET_NAME']='Kitty'
  if name=='KittyTests':settings.update({'TEST_HOST':'$(BUILT_PRODUCTS_DIR)/Kitty.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Kitty','BUNDLE_LOADER':'$(TEST_HOST)'})
 target=obj(name+'target','PBXNativeTarget',buildConfigurationList=configs(name,settings),buildPhases=arr(phases),buildRules='()',dependencies=arr(deps),name=q(name),productName=q(name),productReference=product,productType=q('com.apple.product-type.'+producttype));targets.append(target)
prod=obj('products','PBXGroup',children=arr(products),name=q('Products'),sourceTree=q('<group>'))
main=obj('main','PBXGroup',children=arr(groups+[uid('config'),prod]),sourceTree=q('<group>'))
project=obj('project','PBXProject',attributes='{ BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 2660; }',buildConfigurationList=configs('project',{'CLANG_ENABLE_MODULES':'YES','SWIFT_VERSION':'5.0','IPHONEOS_DEPLOYMENT_TARGET':'17.0'}),compatibilityVersion=q('Xcode 14.0'),developmentRegion=q('en'),hasScannedForEncodings='0',knownRegions='(en,Base)',mainGroup=main,productRefGroup=prod,projectDirPath=q(''),projectRoot=q(''),targets=arr(targets))
p=ROOT/'Kitty.xcodeproj';p.mkdir(exist_ok=True)
(p/'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+ '\n'.join(i+' = '+v+';' for i,v in objects.items())+'\n}; rootObject = '+project+'; }\n')
s=p/'xcshareddata'/'xcschemes';s.mkdir(parents=True,exist_ok=True)
def ref(name):return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid(name+"target")}" BuildableName="{name}.{"app" if name=="Kitty" else "xctest"}" BlueprintName="{name}" ReferencedContainer="container:Kitty.xcodeproj"/>'
(s/'Kitty.xcscheme').write_text(f'''<?xml version="1.0"?><Scheme LastUpgradeVersion="2660" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{ref('Kitty')}</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{ref('KittyTests')}</TestableReference><TestableReference skipped="NO">{ref('KittyUITests')}</TestableReference></Testables></TestAction><LaunchAction buildConfiguration="Debug" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref('Kitty')}</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref('Kitty')}</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''')
print('Generated Kitty.xcodeproj')
