import { useState } from 'react'

interface ApplicationResult {
  serialNumber: string
  hasAttorney: boolean | null
  attorneyName: string
  status: 'pending' | 'checking' | 'done' | 'error'
  error?: string
}

type SetupStep = 'setup' | 'checking' | 'results'

export default function App() {
  const [step, setStep] = useState<SetupStep>('setup')
  const [proxyUrl, setProxyUrl] = useState('')
  const [isProxyValid, setIsProxyValid] = useState(false)
  const [serialInput, setSerialInput] = useState('')
  const [results, setResults] = useState<ApplicationResult[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isChecking, setIsChecking] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState('')

  const googleScriptCode = `function doGet(e) {
  var serialNumber = e.parameter.serial;
  
  try {
    var hasAttorney = false;
    var attorneyName = "";
    
    // Method 1: Try the case documents XML which has attorney info
    var xmlUrl = "https://tsdr.uspto.gov/documentparser/" + serialNumber + "/case.xml";
    var response = UrlFetchApp.fetch(xmlUrl, {
      muteHttpExceptions: true,
      followRedirects: true
    });
    
    var content = response.getContentText();
    
    // Look for attorney name in XML - various tag formats USPTO uses:
    // <ns2:attrneyNm>, <tm:AttorneyName>, <AttorneyName>, etc.
    var xmlPatterns = [
      /<(?:[a-z0-9]+:)?attrneyNm>([^<]+)<\\/(?:[a-z0-9]+:)?attrneyNm>/i,
      /<(?:[a-z0-9]+:)?AttorneyName>([^<]+)<\\/(?:[a-z0-9]+:)?AttorneyName>/i,
      /<(?:[a-z0-9]+:)?attorneyName>([^<]+)<\\/(?:[a-z0-9]+:)?attorneyName>/i
    ];
    
    for (var i = 0; i < xmlPatterns.length; i++) {
      var match = content.match(xmlPatterns[i]);
      if (match && match[1] && match[1].trim() !== "") {
        hasAttorney = true;
        attorneyName = match[1].trim();
        break;
      }
    }
    
    // Method 2: If not found, try the status JSON API
    if (!hasAttorney) {
      try {
        var jsonUrl = "https://tsdrapi.uspto.gov/ts/cd/casestatus/" + serialNumber + "/info.json";
        var jsonResponse = UrlFetchApp.fetch(jsonUrl, {
          muteHttpExceptions: true,
          headers: {
            "Accept": "application/json"
          }
        });
        
        var jsonText = jsonResponse.getContentText();
        
        // Look for attorney name in JSON response
        // Pattern: "attrneyNm":"Name Here" or "attorneyName":"Name Here"
        var jsonPatterns = [
          /"attrneyNm"\\s*:\\s*"([^"]+)"/,
          /"attorneyName"\\s*:\\s*"([^"]+)"/,
          /"AttorneyName"\\s*:\\s*"([^"]+)"/
        ];
        
        for (var j = 0; j < jsonPatterns.length; j++) {
          var jMatch = jsonText.match(jsonPatterns[j]);
          if (jMatch && jMatch[1] && jMatch[1].trim() !== "") {
            hasAttorney = true;
            attorneyName = jMatch[1].trim();
            break;
          }
        }
        
        // Also check if attorney is explicitly null or empty
        if (jsonText.indexOf('"attrneyNm":null') > -1 || 
            jsonText.indexOf('"attrneyNm":""') > -1 ||
            jsonText.indexOf('"attorneyName":null') > -1 ||
            jsonText.indexOf('"attorneyName":""') > -1) {
          hasAttorney = false;
          attorneyName = "";
        }
      } catch (e2) {
        // JSON API failed
      }
    }
    
    // Method 3: Try the status view endpoint
    if (!hasAttorney && !attorneyName) {
      try {
        var statusUrl = "https://tsdr.uspto.gov/statusview/" + serialNumber;
        var statusResponse = UrlFetchApp.fetch(statusUrl, {
          muteHttpExceptions: true,
          followRedirects: true
        });
        
        var statusContent = statusResponse.getContentText();
        
        // Check for "Attorney of Record - None" which means NO attorney
        if (statusContent.indexOf("Attorney of Record - None") > -1) {
          hasAttorney = false;
          attorneyName = "";
        }
        // Check for "Attorney Name:" which means HAS attorney
        else if (statusContent.indexOf("Attorney Name:") > -1) {
          hasAttorney = true;
          // Extract attorney name after "Attorney Name:"
          var nameMatch = statusContent.match(/Attorney Name:[\\s]*([A-Za-z][^<\\n\\r]+)/);
          if (nameMatch && nameMatch[1]) {
            attorneyName = nameMatch[1].trim();
          }
        }
        // Also check for "Attorney of Record" section without "None"
        else if (statusContent.indexOf("Attorney of Record") > -1 && 
                 statusContent.indexOf("Attorney Primary Email") > -1) {
          hasAttorney = true;
        }
      } catch (e3) {
        // Status view failed
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      serialNumber: serialNumber,
      hasAttorney: hasAttorney,
      attorneyName: attorneyName
    })).setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      serialNumber: serialNumber,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}`

  const testProxy = async () => {
    if (!proxyUrl.trim()) {
      setTestError('Please enter your Google Apps Script URL')
      setTestStatus('error')
      return
    }

    setTestStatus('testing')
    setTestError('')

    try {
      const testUrl = `${proxyUrl}?serial=97123456`
      const response = await fetch(testUrl)
      const data = await response.json()

      if (data.success !== undefined) {
        setTestStatus('success')
        setIsProxyValid(true)
      } else {
        setTestStatus('error')
        setTestError('Invalid response from proxy. Make sure you deployed correctly.')
      }
    } catch (error) {
      setTestStatus('error')
      setTestError(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const parseSerialNumbers = (input: string): string[] => {
    return input
      .split(/[\s,]+/)
      .map(s => s.trim().replace(/\D/g, ''))
      .filter(s => s.length >= 7 && s.length <= 8)
  }

  const checkApplication = async (serialNumber: string): Promise<ApplicationResult> => {
    try {
      const response = await fetch(`${proxyUrl}?serial=${serialNumber}`)
      const data = await response.json()

      if (data.success) {
        return {
          serialNumber,
          hasAttorney: data.hasAttorney,
          attorneyName: data.attorneyName || '',
          status: 'done'
        }
      } else {
        return {
          serialNumber,
          hasAttorney: null,
          attorneyName: '',
          status: 'error',
          error: data.error || 'Unknown error'
        }
      }
    } catch (error) {
      return {
        serialNumber,
        hasAttorney: null,
        attorneyName: '',
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to check'
      }
    }
  }

  const startChecking = async () => {
    const serials = parseSerialNumbers(serialInput)
    if (serials.length === 0) {
      alert('Please enter valid serial numbers (7-8 digits)')
      return
    }

    const initialResults: ApplicationResult[] = serials.map(s => ({
      serialNumber: s,
      hasAttorney: null,
      attorneyName: '',
      status: 'pending'
    }))

    setResults(initialResults)
    setCurrentIndex(0)
    setIsChecking(true)
    setStep('checking')

    for (let i = 0; i < serials.length; i++) {
      setCurrentIndex(i)
      setResults(prev => prev.map((r, idx) => 
        idx === i ? { ...r, status: 'checking' } : r
      ))

      const result = await checkApplication(serials[i])
      
      setResults(prev => prev.map((r, idx) => 
        idx === i ? result : r
      ))

      // Small delay between requests
      if (i < serials.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    setIsChecking(false)
    setStep('results')
  }

  const exportCSV = (onlyNoAttorney: boolean) => {
    const dataToExport = onlyNoAttorney 
      ? results.filter(r => r.hasAttorney === false)
      : results.filter(r => r.status === 'done')

    if (dataToExport.length === 0) {
      alert('No data to export!')
      return
    }

    const csv = [
      'Serial Number,Has Attorney,Attorney Name,TSDR Link',
      ...dataToExport.map(r => 
        `${r.serialNumber},${r.hasAttorney ? 'Yes' : 'No'},"${r.attorneyName}",https://tsdr.uspto.gov/#caseNumber=${r.serialNumber}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`
      )
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const filename = onlyNoAttorney ? 'no-attorney-applications.csv' : 'all-applications.csv'
    
    // Create a link and trigger download
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    // Clean up after a short delay
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 100)
  }

  const noAttorneyResults = results.filter(r => r.hasAttorney === false)
  const withAttorneyResults = results.filter(r => r.hasAttorney === true)
  const errorResults = results.filter(r => r.status === 'error')

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <h1 className="text-2xl font-bold text-center">🔍 USPTO Attorney Checker</h1>
        <p className="text-gray-400 text-center text-sm mt-1">Automatically check if trademark applications have attorneys</p>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Setup Step */}
        {step === 'setup' && (
          <div className="space-y-6">
            <div className="bg-blue-900/30 border border-blue-500 rounded-lg p-4">
              <h2 className="text-xl font-bold text-blue-400 mb-2">📋 One-Time Setup (2 minutes)</h2>
              <p className="text-gray-300">
                We'll use Google Apps Script as a free proxy to fetch USPTO data. This is 100% reliable and free!
              </p>
            </div>

            {/* Step 1 */}
            <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
              <h3 className="text-lg font-bold text-yellow-400 mb-3">Step 1: Create Google Apps Script</h3>
              <ol className="list-decimal list-inside space-y-2 text-gray-300 mb-4">
                <li>
                  <a 
                    href="https://script.google.com/home/start" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    Click here to open Google Apps Script →
                  </a>
                </li>
                <li>Click <strong>"New Project"</strong></li>
                <li>Delete any existing code in the editor</li>
                <li>Copy and paste the code below:</li>
              </ol>

              <div className="relative">
                <pre className="bg-gray-900 p-4 rounded text-xs overflow-x-auto text-green-400 max-h-64 overflow-y-auto">
                  {googleScriptCode}
                </pre>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(googleScriptCode)
                    alert('Code copied to clipboard!')
                  }}
                  className="absolute top-2 right-2 bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
                >
                  📋 Copy Code
                </button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
              <h3 className="text-lg font-bold text-yellow-400 mb-3">Step 2: Deploy the Script</h3>
              <ol className="list-decimal list-inside space-y-2 text-gray-300">
                <li>Click <strong>"Deploy"</strong> button (top right) → <strong>"New deployment"</strong></li>
                <li>Click the gear icon ⚙️ next to "Select type" → Choose <strong>"Web app"</strong></li>
                <li>Set these options:
                  <ul className="list-disc list-inside ml-6 mt-1 text-sm">
                    <li>Description: "USPTO Checker"</li>
                    <li>Execute as: <strong>"Me"</strong></li>
                    <li>Who has access: <strong>"Anyone"</strong></li>
                  </ul>
                </li>
                <li>Click <strong>"Deploy"</strong></li>
                <li>Click <strong>"Authorize access"</strong> → Select your Google account → Click "Allow"</li>
                <li><strong>Copy the Web App URL</strong> (it starts with https://script.google.com/...)</li>
              </ol>
            </div>

            {/* Step 3 */}
            <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
              <h3 className="text-lg font-bold text-yellow-400 mb-3">Step 3: Paste Your URL & Test</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Your Google Apps Script URL:</label>
                  <input
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => {
                      setProxyUrl(e.target.value)
                      setIsProxyValid(false)
                      setTestStatus('idle')
                    }}
                    placeholder="https://script.google.com/macros/s/XXXX.../exec"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white"
                  />
                </div>

                <button
                  onClick={testProxy}
                  disabled={testStatus === 'testing'}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-6 py-3 rounded font-bold w-full"
                >
                  {testStatus === 'testing' ? '⏳ Testing...' : '🔌 Test Connection'}
                </button>

                {testStatus === 'success' && (
                  <div className="bg-green-900/50 border border-green-500 rounded p-3 text-green-400">
                    ✅ Connected successfully! You can now check applications.
                  </div>
                )}

                {testStatus === 'error' && (
                  <div className="bg-red-900/50 border border-red-500 rounded p-3 text-red-400">
                    ❌ {testError}
                  </div>
                )}
              </div>
            </div>

            {/* Serial Numbers Input */}
            {isProxyValid && (
              <div className="bg-gray-800 rounded-lg p-5 border border-green-500">
                <h3 className="text-lg font-bold text-green-400 mb-3">✅ Ready! Enter Serial Numbers</h3>
                
                <textarea
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  placeholder="Enter serial numbers (comma, space, or newline separated)&#10;Example: 97123456, 97234567, 97345678"
                  className="w-full h-40 bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white font-mono"
                />

                <div className="mt-4 flex justify-between items-center">
                  <span className="text-gray-400">
                    {parseSerialNumbers(serialInput).length} serial numbers detected
                  </span>
                  <button
                    onClick={startChecking}
                    disabled={parseSerialNumbers(serialInput).length === 0}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-8 py-3 rounded font-bold text-lg"
                  >
                    🚀 Start Checking
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Checking Step */}
        {step === 'checking' && (
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
              <h2 className="text-xl font-bold mb-4">
                {isChecking ? '⏳ Checking Applications...' : '✅ Checking Complete!'}
              </h2>

              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-400 mb-1">
                  <span>Progress</span>
                  <span>{currentIndex + 1} / {results.length}</span>
                </div>
                <div className="h-4 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${((currentIndex + 1) / results.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Current Application */}
              {isChecking && results[currentIndex] && (
                <div className="bg-gray-700 rounded p-3 text-center">
                  <span className="text-gray-400">Currently checking: </span>
                  <span className="text-white font-mono">{results[currentIndex].serialNumber}</span>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-green-900/30 border border-green-500 rounded p-3 text-center">
                  <div className="text-2xl font-bold text-green-400">{withAttorneyResults.length}</div>
                  <div className="text-sm text-gray-400">With Attorney</div>
                </div>
                <div className="bg-yellow-900/30 border border-yellow-500 rounded p-3 text-center">
                  <div className="text-2xl font-bold text-yellow-400">{noAttorneyResults.length}</div>
                  <div className="text-sm text-gray-400">No Attorney</div>
                </div>
                <div className="bg-red-900/30 border border-red-500 rounded p-3 text-center">
                  <div className="text-2xl font-bold text-red-400">{errorResults.length}</div>
                  <div className="text-sm text-gray-400">Errors</div>
                </div>
              </div>

              {!isChecking && (
                <button
                  onClick={() => setStep('results')}
                  className="mt-4 w-full bg-blue-600 hover:bg-blue-700 py-3 rounded font-bold"
                >
                  View Results →
                </button>
              )}
            </div>
          </div>
        )}

        {/* Results Step */}
        {step === 'results' && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-green-900/30 border border-green-500 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-green-400">{withAttorneyResults.length}</div>
                <div className="text-gray-400">With Attorney</div>
              </div>
              <div className="bg-yellow-900/30 border border-yellow-500 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-yellow-400">{noAttorneyResults.length}</div>
                <div className="text-gray-400">No Attorney</div>
              </div>
              <div className="bg-red-900/30 border border-red-500 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-red-400">{errorResults.length}</div>
                <div className="text-gray-400">Errors</div>
              </div>
            </div>

            {/* Export Buttons */}
            <div className="flex gap-4">
              <button
                onClick={() => exportCSV(true)}
                disabled={noAttorneyResults.length === 0}
                className="flex-1 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 py-3 rounded font-bold"
              >
                📥 Export No-Attorney List ({noAttorneyResults.length})
              </button>
              <button
                onClick={() => exportCSV(false)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 py-3 rounded font-bold"
              >
                📥 Export All Results
              </button>
            </div>

            {/* No Attorney Applications */}
            {noAttorneyResults.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-500 rounded-lg p-5">
                <h3 className="text-xl font-bold text-yellow-400 mb-4">
                  ⚠️ Applications WITHOUT Attorney ({noAttorneyResults.length})
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {noAttorneyResults.map(r => (
                    <div key={r.serialNumber} className="flex justify-between items-center bg-gray-800 rounded p-3">
                      <span className="font-mono">{r.serialNumber}</span>
                      <a
                        href={`https://tsdr.uspto.gov/#caseNumber=${r.serialNumber}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline text-sm"
                      >
                        View on TSDR →
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* With Attorney Applications */}
            {withAttorneyResults.length > 0 && (
              <div className="bg-green-900/20 border border-green-500 rounded-lg p-5">
                <h3 className="text-xl font-bold text-green-400 mb-4">
                  ✅ Applications WITH Attorney ({withAttorneyResults.length})
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {withAttorneyResults.map(r => (
                    <div key={r.serialNumber} className="flex justify-between items-center bg-gray-800 rounded p-3">
                      <div>
                        <span className="font-mono">{r.serialNumber}</span>
                        {r.attorneyName && (
                          <span className="text-gray-400 ml-3 text-sm">— {r.attorneyName}</span>
                        )}
                      </div>
                      <a
                        href={`https://tsdr.uspto.gov/#caseNumber=${r.serialNumber}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline text-sm"
                      >
                        View on TSDR →
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Applications */}
            {errorResults.length > 0 && (
              <div className="bg-red-900/20 border border-red-500 rounded-lg p-5">
                <h3 className="text-xl font-bold text-red-400 mb-4">
                  ❌ Errors ({errorResults.length})
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {errorResults.map(r => (
                    <div key={r.serialNumber} className="flex justify-between items-center bg-gray-800 rounded p-3">
                      <div>
                        <span className="font-mono">{r.serialNumber}</span>
                        <span className="text-red-400 ml-3 text-sm">— {r.error}</span>
                      </div>
                      <a
                        href={`https://tsdr.uspto.gov/#caseNumber=${r.serialNumber}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline text-sm"
                      >
                        Check Manually →
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Start Over */}
            <button
              onClick={() => {
                setStep('setup')
                setResults([])
                setSerialInput('')
              }}
              className="w-full bg-gray-700 hover:bg-gray-600 py-3 rounded"
            >
              ← Check More Applications
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
