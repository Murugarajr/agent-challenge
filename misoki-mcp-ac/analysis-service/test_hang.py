import asyncio
from app.settings import get_settings
from app.services.repo_analyzer import get_repo_analyzer_service
from app.schemas.analyze import RepoAnalyzeRequest

async def main():
    print("Initializing...")
    service = get_repo_analyzer_service()
    
    req = RepoAnalyzeRequest(
        github_url="https://github.com/pallets/flask",
        max_files=40,
        include_categories=["architecture", "dead_code", "duplication", "performance", "type_hints"]
    )
    
    print("Fetching snapshot...")
    snapshot = await service.fetcher.fetch_repo_snapshot(
        github_url=req.github_url,
        branch=req.branch,
        max_files=min(req.max_files, service.settings.max_repo_files),
    )
    
    selection = service.file_filter.select_files(
        files=snapshot.files,
        max_files=min(req.max_files, service.settings.max_repo_files),
    )
    
    print(f"Loaded {len(selection.selected_files)} files. Starting analysis.")
    
    categories = set(req.include_categories)
    
    for repo_file in selection.selected_files:
        print(f"Analyzing: {repo_file.path} ({len(repo_file.content)} bytes)")
        if "architecture" in categories:
            service.architecture_analyzer.analyze_file(repo_file.content, repo_file.path)
        if "dead_code" in categories:
            service.dead_code_detector.detect_all(repo_file.content, repo_file.path)
        if "performance" in categories:
            service.performance_analyzer.analyze_performance(repo_file.content, repo_file.path)
        if "type_hints" in categories:
            service._analyze_type_hints(repo_file)
        if "code_quality" in categories:
            service.code_analyzer.analyze(repo_file.content, repo_file.path)
            
    print("Running duplication...")
    if "duplication" in categories:
        service._analyze_duplication(selection.selected_files)
        
    print("Done!")

if __name__ == "__main__":
    asyncio.run(main())
