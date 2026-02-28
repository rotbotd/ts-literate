/// Test file for indented prose comments

function complexFunction(x: number): number {
  /// This prose is inside the function body.
  /// It should be extracted properly despite indentation.
  const doubled = x * 2;
  
  /// Now we'll do something else:
  if (doubled > 10) {
    /// Even more nested prose!
    return doubled;
  }
  
  return x;
}
