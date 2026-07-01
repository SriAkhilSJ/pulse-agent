use surpassing_sandbox::*;

#[tokio::test]
async fn test_python_hello_world() {
    let sandbox = Sandbox::new().await.unwrap();
    let req = SandboxRequest {
        code: r#"print("Hello from sandbox!")
x = 42
print(f"The answer is {x}")"#.to_string(),
        language: Language::Python,
        test_command: None,
        resource_limits: ResourceLimits::default(),
        isolation: IsolationLevel::Docker,
        working_dir: None,
        env_vars: vec![],
    };
    let result = sandbox.execute(req).await.unwrap();
    assert_eq!(result.exit_code, 0, "exit code 0 expected, got {}: {}", result.exit_code, result.stderr);
    assert!(result.stdout.contains("Hello from sandbox!"), "stdout: {}", result.stdout);
    assert!(result.approved);
}

#[tokio::test]
async fn test_security_blocks_dangerous() {
    let sandbox = Sandbox::new().await.unwrap();
    let req = SandboxRequest {
        code: r#"import os
os.system("rm -rf /")
eval("dangerous")"#.to_string(),
        language: Language::Python,
        test_command: None,
        resource_limits: ResourceLimits::default(),
        isolation: IsolationLevel::Docker,
        working_dir: None,
        env_vars: vec![],
    };
    let result = sandbox.execute(req).await.unwrap();
    assert_eq!(result.exit_code, -1);
    assert!(!result.approved);
}

#[tokio::test]
async fn test_git_branch() {
    let git = GitIntegration::new(r"D:\pulse");
    let _ = git.current_branch().await.unwrap();
}
